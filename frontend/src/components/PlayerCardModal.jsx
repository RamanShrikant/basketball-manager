import { getContractSeasonYear, getDisplaySeasonYear } from "../utils/seasonContext.js";
import { getCanonicalPlayer } from "../utils/playerResolver.js";
import { createPortal } from "react-dom";
import React, { useEffect, useMemo, useRef, useState } from "react";
import LZString from "lz-string";
import RuntimePlayerPortrait from "./RuntimePlayerPortrait.jsx";
import { getMergedLeagueHistory, normalizeHistoryName } from "../utils/leagueHistoryUtils.js";

const ATTR_LABELS = [
  "3PT",
  "MID",
  "CLOSE",
  "FT",
  "BALL",
  "PASS",
  "SPEED",
  "ATH",
  "PER D",
  "INS D",
  "BLK",
  "STL",
  "REB",
  "OIQ",
  "DIQ",
];

const ATTRIBUTE_DISPLAY_NAMES = {
  "3PT": "Three-Point Shooting",
  MID: "Mid-Range Shooting",
  CLOSE: "Close Range Finishing",
  FT: "Free Throw Shooting",
  BALL: "Ball Handling",
  PASS: "Passing",
  SPEED: "Speed",
  ATH: "Athleticism",
  "PER D": "Perimeter Defense",
  "INS D": "Interior Defense",
  BLK: "Shot Blocking",
  STL: "Steals",
  REB: "Rebounding",
  OIQ: "Offensive IQ",
  DIQ: "Defensive IQ",
};


const TEAM_ABBREVIATIONS = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "LA Clippers": "LAC",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "attributes", label: "Attributes" },
  { key: "contract", label: "Contract" },
  { key: "trends", label: "Trends" },
  { key: "career", label: "Career Stats" },
  { key: "accolades", label: "Accolades" },
];

const MOOD_COLORS = {
  "Very Happy": "from-emerald-400 to-green-500 text-emerald-100 border-emerald-400/30",
  Happy: "from-green-400 to-lime-500 text-green-100 border-green-400/30",
  Content: "from-orange-400 to-amber-500 text-orange-100 border-orange-400/30",
  Frustrated: "from-yellow-400 to-orange-500 text-yellow-100 border-yellow-400/30",
  Unhappy: "from-red-400 to-red-600 text-red-100 border-red-400/30",
};

const PLAYER_STATS_KEY = "bm_player_stats_v1";
const AWARDS_KEY = "bm_awards_v1";
const FINALS_MVP_KEY = "bm_finals_mvp_v1";
const ALL_STARS_KEY = "bm_all_stars_v1";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeJSON(raw, fallback = {}) {
  try {
    return raw ? JSON.parse(raw) || fallback : fallback;
  } catch {
    return fallback;
  }
}

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

function formatDollars(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMillions(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0.0M";
  return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatHeight(inches) {
  const n = Number(inches || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${Math.floor(n / 12)}'${n % 12}\"`;
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getAllPlayersFromLeague(leagueData) {
  const players = [];
  const add = (rows) => {
    if (Array.isArray(rows)) players.push(...rows.filter(Boolean));
  };

  for (const team of getAllTeamsFromLeague(leagueData)) {
    add(team?.players);
    add(team?.twoWayPlayers);
    add(team?.stashPlayers);
  }

  add(leagueData?.freeAgents);
  return players;
}

function buildLeagueAttributeAverages(leagueData) {
  const totals = ATTR_LABELS.map(() => 0);
  const counts = ATTR_LABELS.map(() => 0);

  for (const player of getAllPlayersFromLeague(leagueData)) {
    if (!Array.isArray(player?.attrs)) continue;

    ATTR_LABELS.forEach((_, index) => {
      const value = Number(player.attrs[index]);
      if (Number.isFinite(value) && value > 0) {
        totals[index] += value;
        counts[index] += 1;
      }
    });
  }

  return ATTR_LABELS.map((_, index) => (counts[index] ? totals[index] / counts[index] : 0));
}

function getTeamLogoIndex(leagueData) {
  const map = {};
  for (const team of getAllTeamsFromLeague(leagueData)) {
    if (!team?.name) continue;
    map[team.name] = team.logo || team.teamLogo || team.newTeamLogo || team.logoUrl || team.image || team.img || "";
  }
  return map;
}

function getLatestTeamHistory(leagueData, teamName) {
  const seasons = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  for (const season of [...seasons].reverse()) {
    const row = (season?.teams || []).find((team) => team?.teamName === teamName);
    if (row) return row;
  }
  return null;
}

function getPrimaryTeamName(player, teamName) {
  if (teamName) return teamName;
  if (player?.teamName) return player.teamName;
  if (player?.rights?.heldByTeam) return player.rights.heldByTeam;

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const latest = [...seasons].reverse().find((row) => row?.rowType !== "total" && row?.teamName);
  return latest?.teamName || "Free Agent";
}

function getPrimaryTeamLogo(player, teamLogo, leagueData, teamName) {
  if (teamLogo) return teamLogo;
  if (player?.teamLogo) return player.teamLogo;

  const team = getAllTeamsFromLeague(leagueData).find((row) => row?.name === teamName);
  if (team?.logo) return team.logo;

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const latest = [...seasons].reverse().find((row) => row?.rowType !== "total" && row?.teamLogo);
  return latest?.teamLogo || "";
}

function getContractYears(contract) {
  return Array.isArray(contract?.salaryByYear) ? contract.salaryByYear.length : 0;
}

function getContractAav(contract) {
  const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  if (!salaryByYear.length) return 0;
  return salaryByYear.reduce((sum, salary) => sum + Number(salary || 0), 0) / salaryByYear.length;
}

function getRemainingContractView(contract, leagueData) {
  const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  const startYear = safeNumber(contract?.startYear, 0);
  if (!salaryByYear.length || !startYear) {
    return { rows: [], years: 0, aav: 0, displayStartYear: startYear || null };
  }

  const payrollSeasonYear = safeNumber(getContractSeasonYear(leagueData || {}), startYear);
  const rawOffset = payrollSeasonYear - startYear;
  const offset = Math.max(0, Math.min(salaryByYear.length, rawOffset));
  const rows = salaryByYear.slice(offset).map((salary, localIndex) => {
    const originalIndex = offset + localIndex;
    return {
      salary,
      originalIndex,
      seasonYear: startYear + originalIndex,
    };
  });
  const aav = rows.length
    ? rows.reduce((sum, row) => sum + Number(row.salary || 0), 0) / rows.length
    : 0;

  return {
    rows,
    years: rows.length,
    aav,
    displayStartYear: rows[0]?.seasonYear ?? null,
  };
}

function formatBirdLevel(level) {
  if (level === "bird") return "Bird";
  if (level === "early_bird" || level === "early bird") return "Early Bird";
  if (level === "non_bird" || level === "non-bird") return "Non-Bird";
  if (!level || level === "none" || level === "no rights") return "No Rights";
  return String(level).replaceAll("_", " ");
}

function getContractType(player) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  return String(player?.contractType || player?.rosterStatus || contract?.type || "standard").toLowerCase();
}

function getContractTypeLabel(player) {
  const type = getContractType(player);
  if (type === "two_way" || type === "two-way") return "Two-Way Contract";
  if (type === "rookie_scale") return "Rookie Scale";
  if (type === "minimum") return "Minimum Contract";
  if (type === "extension") return "Extension";
  if (type === "free_agent") return "Free Agent";
  if (type === "unsigned_rookie" || type === "rookie_pending") return "Unsigned Rookie";
  if (type === "draft_rights") return "Draft Rights";
  if (["stash", "stashed", "draft_stash", "g_league_stash", "overseas_stash"].includes(type)) return "Stash Rights";
  return "Standard Contract";
}

function getContractTypeTone(player) {
  const type = getContractType(player);
  if (type === "two_way" || type === "two-way") return "orange";
  if (["stash", "stashed", "draft_stash", "g_league_stash", "overseas_stash"].includes(type)) return "orange";
  if (type === "free_agent" || type === "unsigned_rookie" || type === "rookie_pending") return "red";
  return "green";
}

function getAssignmentLabel(player) {
  const status = String(player?.assignmentStatus || "").toLowerCase();
  if (status === "g_league") return "G League";
  if (status === "nba") return "NBA Roster";
  if (status === "free_agent") return "Free Agent";
  if (status === "unsigned_rookie") return "Unsigned Rookie";
  return "";
}

function getPlayerPortraitUrl(player) {
  return player?.headshot || player?.image || player?.img || "";
}

function getMoodLabel(value) {
  if (value >= 85) return "Very Happy";
  if (value >= 70) return "Happy";
  if (value >= 50) return "Content";
  if (value >= 35) return "Frustrated";
  return "Unhappy";
}

function getCurrentSeasonDisplayYear(leagueData) {
  return getDisplaySeasonYear(leagueData || {});
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

function teamAbbrev(teamName) {
  const clean = String(teamName || "").trim();
  if (!clean) return "-";
  if (TEAM_ABBREVIATIONS[clean]) return TEAM_ABBREVIATIONS[clean];
  const words = clean.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return clean.slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}

function uniqueTeamNames(rows) {
  const out = [];
  for (const row of rows || []) {
    const teamName = String(row?.teamName || row?.team || "").trim();
    if (teamName && teamName !== "Total" && !out.includes(teamName)) out.push(teamName);
  }
  return out;
}

function weightedRowsAverage(rows, key, games) {
  const safeGames = games || 1;
  return round1((rows || []).reduce((sum, row) => {
    const gp = Number(row?.games ?? row?.gp ?? 0);
    return sum + Number(row?.[key] || 0) * gp;
  }, 0) / safeGames);
}

function normalizeSeasonRowIdentity(row = {}) {
  const source = String(row?.source || (row?.simulated ? "sim" : "history"));
  const team = String(row?.teamName || row?.team || "").trim();
  const games = Number(row?.games ?? row?.gp ?? 0);
  const ppg = Number(row?.ppg ?? 0);
  const rpg = Number(row?.rpg ?? 0);
  const apg = Number(row?.apg ?? 0);
  return `${source}|${team}|${games}|${ppg.toFixed(1)}|${rpg.toFixed(1)}|${apg.toFixed(1)}`;
}

function dedupeDisplaySeasonRows(rows = []) {
  const seen = new Set();
  const unique = [];
  for (const row of rows || []) {
    if (!row || row.rowType === "total") continue;
    const key = normalizeSeasonRowIdentity(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const totalGames = unique.reduce((sum, row) => sum + Number(row?.games ?? row?.gp ?? 0), 0);
  if (totalGames <= 90 || unique.length <= 1) return unique;

  const archived = unique.filter((row) => row?.source === "sim" || row?.simulated || row?.recoveredFromStatsArchive);
  const live = unique.filter((row) => row?.source === "live");

  // During offseason/player cards, a just-archived season and a stale live stats map can both exist.
  // If that creates impossible 100+ GP rows, prefer the archived season snapshot and drop live duplicates.
  if (archived.length && live.length) {
    const archivedGames = archived.reduce((sum, row) => sum + Number(row?.games ?? row?.gp ?? 0), 0);
    if (archivedGames > 0 && archivedGames <= 90) return archived;
  }

  return unique;
}

function combineDisplaySeasonRows(rows) {
  // Patch 29: free-agency signings/archived fallbacks can create a zero-game
  // current-team row for the previous season. Do not let those rows append the
  // new team to a real historical season (ex: DAL/PHX when the player signed
  // with Phoenix after that season ended).
  const realGameRows = (rows || []).filter((row) => Number(row?.games ?? row?.gp ?? 0) > 0);
  const sourceRows = realGameRows.length ? realGameRows : rows;
  const clean = dedupeDisplaySeasonRows(sourceRows);
  if (!clean.length) return null;

  const rawGames = clean.reduce((sum, row) => sum + Number(row?.games ?? row?.gp ?? 0), 0);
  const games = Math.min(rawGames, 82);
  const averageGames = rawGames || games || 1;
  const teamNames = uniqueTeamNames(clean);
  const latest = [...clean].reverse().find(Boolean) || {};
  const multiTeam = teamNames.length > 1;

  return {
    ...latest,
    seasonYear: Number(latest?.seasonYear || clean[0]?.seasonYear || 0),
    teamName: multiTeam ? teamNames.map(teamAbbrev).join("/") : latest.teamName,
    teamLogo: multiTeam ? "" : latest.teamLogo,
    rowType: "team",
    games,
    ppg: weightedRowsAverage(clean, "ppg", averageGames),
    rpg: weightedRowsAverage(clean, "rpg", averageGames),
    apg: weightedRowsAverage(clean, "apg", averageGames),
    spg: weightedRowsAverage(clean, "spg", averageGames),
    bpg: weightedRowsAverage(clean, "bpg", averageGames),
    fgPct: weightedRowsAverage(clean, "fgPct", averageGames),
    threePct: weightedRowsAverage(clean, "threePct", averageGames),
    ftPct: weightedRowsAverage(clean, "ftPct", averageGames),
  };
}

function combineRowsBySeasonYear(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const seasonYear = Number(row?.seasonYear || 0);
    if (!seasonYear) continue;
    if (!grouped.has(seasonYear)) grouped.set(seasonYear, []);
    grouped.get(seasonYear).push(row);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, seasonRows]) => combineDisplaySeasonRows(seasonRows))
    .filter(Boolean);
}

function buildSeasonRowFromStats(rec, seasonYear, teamLogoMap) {
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
    source: "live",
  };
}

function statDisplayNumber(value, fallback = 0) {
  const n = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : fallback;
}

function buildSeasonRowFromArchivedSnapshot(row, displaySeasonYear, teamLogoMap) {
  const stats = row?.stats && typeof row.stats === "object" ? row.stats : {};
  const teamName = row?.teamName || row?.team || "Free Agent";
  const gp = statDisplayNumber(row?.games ?? row?.gp ?? row?.GP ?? stats.GP, 0);
  if (gp <= 0) return null;
  return {
    seasonYear: displaySeasonYear,
    teamName,
    teamLogo: row?.teamLogo || row?.logo || teamLogoMap[teamName] || "",
    games: gp,
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

function collectArchivedSnapshotRowsForPlayer({ leagueData, playerName, currentSeasonYear, existingRows, teamLogoMap }) {
  if (!playerName) return [];
  const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  const existingKeys = new Set(
    (existingRows || []).map((row) => `${Number(row?.seasonYear || 0)}__${String(row?.teamName || row?.team || "")}`)
  );
  const seasonsWithRealHistoricalRows = new Set(
    (existingRows || [])
      .filter((row) => Number(row?.games ?? row?.gp ?? 0) > 0)
      .map((row) => Number(row?.seasonYear || 0))
      .filter(Boolean)
  );
  const rows = [];

  for (const entry of history) {
    const playerRows = entry?.statsArchive?.regular?.playerRows;
    if (!Array.isArray(playerRows) || !playerRows.length) continue;

    const snapshotStartYear = Number(entry?.statsArchive?.regular?.seasonYear || entry?.seasonYear || 0);
    const displaySeasonYear = snapshotStartYear > 1900 ? snapshotStartYear + 1 : 0;
    if (!displaySeasonYear || displaySeasonYear >= Number(currentSeasonYear || 0)) continue;

    for (const snapshotRow of playerRows) {
      const rowName = snapshotRow?.name || snapshotRow?.player;
      if (rowName !== playerName) continue;
      const built = buildSeasonRowFromArchivedSnapshot(snapshotRow, displaySeasonYear, teamLogoMap);
      if (!built) continue;
      if (seasonsWithRealHistoricalRows.has(Number(built.seasonYear || 0))) continue;
      const key = `${Number(built.seasonYear || 0)}__${String(built.teamName || "")}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      rows.push(built);
    }
  }

  return rows;
}

function buildEmptyLiveSeasonRow(player, seasonYear, teamName, teamLogo) {
  return {
    seasonYear,
    teamName: teamName || player?.teamName || "Free Agent",
    teamLogo: teamLogo || player?.teamLogo || "",
    games: 0,
    ppg: 0,
    rpg: 0,
    apg: 0,
    spg: 0,
    bpg: 0,
    fgPct: 0,
    threePct: 0,
    ftPct: 0,
    source: "live",
  };
}

function combineStatRecords(records, playerName) {
  const total = {
    player: playerName,
    team: "Total",
    gp: 0,
    min: 0,
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
  };

  for (const rec of records) {
    total.gp += Number(rec?.gp || 0);
    total.min += Number(rec?.min || 0);
    total.pts += Number(rec?.pts || 0);
    total.reb += Number(rec?.reb || 0);
    total.ast += Number(rec?.ast || 0);
    total.stl += Number(rec?.stl || 0);
    total.blk += Number(rec?.blk || 0);
    total.fgm += Number(rec?.fgm || 0);
    total.fga += Number(rec?.fga || 0);
    total.tpm += Number(rec?.tpm || 0);
    total.tpa += Number(rec?.tpa || 0);
    total.ftm += Number(rec?.ftm || 0);
    total.fta += Number(rec?.fta || 0);
  }

  return total;
}

function buildPlayerCardSeasonRows({ player, leagueData, resolvedTeamName, resolvedTeamLogo }) {
  const currentSeasonYear = getCurrentSeasonDisplayYear(leagueData);
  const teamLogoMap = getTeamLogoIndex(leagueData);
  const statsMap = readCompressedOrJson(PLAYER_STATS_KEY, {});
  const rawHistory = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];

  const historicalRows = rawHistory.filter((row) => {
    const seasonYear = Number(row?.seasonYear || 0);
    if (row?.rowType === "total") return false;
    if (row?.source === "sim" || row?.simulated === true) return true;
    return seasonYear > 0 && seasonYear < currentSeasonYear;
  });

  const playerName = player?.name || player?.player || "";
  const liveRecords = [];

  for (const [key, rec] of Object.entries(statsMap || {})) {
    const recPlayer = rec?.player || key.split("__")[0];
    if (recPlayer === playerName && Number(rec?.gp || 0) > 0) liveRecords.push(rec);
  }

  const archivedFallbackRows = collectArchivedSnapshotRowsForPlayer({
    leagueData,
    playerName,
    currentSeasonYear,
    existingRows: historicalRows,
    teamLogoMap,
  });

  const liveRows = liveRecords.length
    ? liveRecords.map((rec) => buildSeasonRowFromStats(rec, currentSeasonYear, teamLogoMap))
    : [];

  return [
    ...combineRowsBySeasonYear([
      ...historicalRows,
      ...archivedFallbackRows,
    ].filter((row) => !liveRows.length || Number(row?.seasonYear || 0) !== Number(currentSeasonYear))),
    ...combineRowsBySeasonYear(liveRows),
  ].sort((a, b) => Number(a?.seasonYear || 0) - Number(b?.seasonYear || 0));
}

function getAccoladeSeasonYear(row) {
  return Number(row?.seasonYear || row?.season || row?.year || 0);
}

function getAllStarSeasonYear(data, fallbackYear) {
  const seasonText = String(data?.season || "");
  const match = seasonText.match(/(\d{4})\s*-\s*(\d{4})/);
  if (match) {
    const endYear = Number(match[2]);
    if (Number.isFinite(endYear) && endYear > 1900) return endYear;
  }

  const cutoffYear = Number(String(data?.cutoff_date || "").slice(0, 4));
  if (Number.isFinite(cutoffYear) && cutoffYear > 1900) return cutoffYear;
  return fallbackYear;
}

function addUniqueAccolade(rows, next) {
  const exists = rows.some((row) => (
    getAccoladeSeasonYear(row) === getAccoladeSeasonYear(next) &&
    String(row?.type || "") === String(next?.type || "") &&
    String(row?.label || "") === String(next?.label || "")
  ));
  if (!exists) rows.push(next);
}

function collectPersistentLeagueHistoryAccolades(player, leagueData) {
  const playerName = player?.name || player?.player || "";
  const playerKey = normalizeHistoryName(playerName);
  if (!playerKey) return [];

  const history = getMergedLeagueHistory(leagueData || {});
  const rows = [];

  for (const [awardKey, awardRows] of Object.entries(history?.awards || {})) {
    for (const row of awardRows || []) {
      if (normalizeHistoryName(row?.player || row?.playerName || row?.name) !== playerKey) continue;
      addUniqueAccolade(rows, {
        seasonYear: Number(row?.seasonYear || 0),
        type: row?.key || row?.awardKey || awardKey,
        label: row?.label || row?.shortLabel || awardKey,
        team: row?.team || null,
        source: "leagueHistory",
        simulated: row?.source !== "real_nba_seed",
      });
    }
  }

  const seasonRows = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const champions = Array.isArray(history?.champions) ? history.champions : [];

  for (const season of seasonRows) {
    if (!season || season?.rowType === "total") continue;
    const seasonYear = Number(season?.seasonYear || season?.year || 0);
    const teamName = season?.teamName || season?.team || "";
    if (!seasonYear || !teamName) continue;

    const champion = champions.find((row) =>
      Number(row?.seasonYear || 0) === seasonYear &&
      normalizeHistoryName(row?.championTeam || row?.team || row?.teamName) === normalizeHistoryName(teamName)
    );
    if (!champion) continue;

    addUniqueAccolade(rows, {
      seasonYear,
      type: "champion",
      label: "NBA Champion",
      team: champion?.championTeam || teamName,
      source: "leagueHistory",
      simulated: champion?.source !== "real_nba_seed",
    });
  }

  for (const champion of champions) {
    if (normalizeHistoryName(champion?.finalsMvp || champion?.finals_mvp_player) !== playerKey) continue;
    addUniqueAccolade(rows, {
      seasonYear: Number(champion?.seasonYear || 0),
      type: "finals_mvp",
      label: "Finals MVP",
      team: champion?.finalsMvpTeam || champion?.championTeam || null,
      source: "leagueHistory",
      simulated: champion?.source !== "real_nba_seed",
    });
  }

  return rows;
}

function collectLiveSeasonAccolades(playerName, leagueData, resolvedTeamName) {
  if (!playerName) return [];

  const currentSeasonYear = getCurrentSeasonDisplayYear(leagueData);
  const rows = [];
  const add = (player, accolade) => {
    if (player === playerName) addUniqueAccolade(rows, { ...accolade, source: "live", simulated: true });
  };

  const awards = readCompressedOrJson(AWARDS_KEY, null);
  if (awards) {
    const winnerRows = [
      ["mvp", "Most Valuable Player"],
      ["dpoy", "Defensive Player of the Year"],
      ["sixth_man", "Sixth Man of the Year"],
      ["mip", "Most Improved Player"],
      ["clutch_player", "Clutch Player of the Year"],
      ["roty", "Rookie of the Year"],
    ];

    for (const [type, label] of winnerRows) {
      const winner = awards?.[type];
      add(winner?.player, { seasonYear: currentSeasonYear, type, label, team: winner?.team || null });
    }

    const teamRows = [
      ["all_nba_first", "All-NBA First Team"],
      ["all_nba_second", "All-NBA Second Team"],
      ["all_nba_third", "All-NBA Third Team"],
      ["all_rookie_first", "All-Rookie First Team"],
      ["all_rookie_second", "All-Rookie Second Team"],
      ["all_defensive_first", "All-Defensive First Team"],
      ["all_defensive_second", "All-Defensive Second Team"],
    ];

    for (const [type, label] of teamRows) {
      for (const row of awards?.[type] || []) {
        add(row?.player, { seasonYear: currentSeasonYear, type, label, team: row?.team || null });
      }
    }
  }

  const finalsMvp = readCompressedOrJson(FINALS_MVP_KEY, null);
  const finalsSeasonYear = Number(finalsMvp?.season || finalsMvp?.seasonYear || currentSeasonYear);
  const fmvp = finalsMvp?.finals_mvp;
  if (Number(finalsSeasonYear) === Number(currentSeasonYear)) {
    add(fmvp?.player, {
      seasonYear: finalsSeasonYear,
      type: "finals_mvp",
      label: "Finals MVP",
      team: fmvp?.team || finalsMvp?.champion_team || null,
    });

    const championTeam = finalsMvp?.champion_team || fmvp?.team || null;
    if (championTeam && championTeam === resolvedTeamName) {
      add(playerName, {
        seasonYear: finalsSeasonYear,
        type: "champion",
        label: "NBA Champion",
        team: championTeam,
      });
    }
  }

  const allStars = readCompressedOrJson(ALL_STARS_KEY, null);
  if (allStars) {
    const seasonYear = getAllStarSeasonYear(allStars, currentSeasonYear);
    if (Number(seasonYear) === Number(currentSeasonYear)) {
      const addAllStars = (starRows) => {
        for (const row of starRows || []) {
          add(row?.player || row?.name, {
            seasonYear,
            type: "all_star",
            label: "NBA All-Star",
            team: row?.team || null,
          });
        }
      };
      addAllStars(allStars?.east?.starters);
      addAllStars(allStars?.west?.starters);
      addAllStars(allStars?.east?.reserves);
      addAllStars(allStars?.west?.reserves);
    }
  }

  return rows;
}

function buildPlayerCardAccolades({ player, leagueData, resolvedTeamName }) {
  const currentSeasonYear = getCurrentSeasonDisplayYear(leagueData);
  const playerName = player?.name || player?.player || "";
  const rawAccolades = Array.isArray(player?.history?.accolades) ? player.history.accolades : [];

  const merged = rawAccolades.filter((row) => {
    const seasonYear = getAccoladeSeasonYear(row);
    if (row?.source === "sim" || row?.source === "live" || row?.simulated === true) return true;
    return seasonYear > 0 && seasonYear < currentSeasonYear;
  });

  for (const row of collectPersistentLeagueHistoryAccolades(player, leagueData)) {
    addUniqueAccolade(merged, row);
  }

  for (const row of collectLiveSeasonAccolades(playerName, leagueData, resolvedTeamName)) {
    addUniqueAccolade(merged, row);
  }

  return merged.sort((a, b) => {
    const ay = getAccoladeSeasonYear(a);
    const by = getAccoladeSeasonYear(b);
    if (ay !== by) return ay - by;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  });
}

function accoladeText(row) {
  return `${row?.label || ""} ${row?.type || ""} ${row?.details || ""}`.toLowerCase();
}

function isMvpAccolade(row) {
  const text = accoladeText(row);
  return (row?.type === "mvp" || text.includes("most valuable player") || text === "mvp") && !text.includes("finals");
}

function isDpoyAccolade(row) {
  return row?.type === "dpoy" || accoladeText(row).includes("defensive player of the year");
}

function isFinalsMvpAccolade(row) {
  return row?.type === "finals_mvp" || accoladeText(row).includes("finals mvp");
}

function isAllNbaAccolade(row) {
  return String(row?.type || "").startsWith("all_nba") || accoladeText(row).includes("all-nba");
}

function isAllDefensiveAccolade(row) {
  return String(row?.type || "").startsWith("all_defensive") || accoladeText(row).includes("all-defensive");
}

function isAllRookieAccolade(row) {
  return String(row?.type || "").startsWith("all_rookie") || accoladeText(row).includes("all-rookie");
}

function isAllStarAccolade(row) {
  return row?.type === "all_star" || accoladeText(row).includes("all-star");
}

function isRookieAccolade(row) {
  return row?.type === "roty" || accoladeText(row).includes("rookie of the year");
}

function isSixthManAccolade(row) {
  return row?.type === "sixth_man" || accoladeText(row).includes("sixth man");
}

function isMipAccolade(row) {
  return row?.type === "mip" || accoladeText(row).includes("most improved");
}

function isClutchAccolade(row) {
  return row?.type === "clutch_player" || accoladeText(row).includes("clutch player");
}

function isChampionAccolade(row) {
  return row?.type === "champion" || accoladeText(row).includes("nba champion");
}

function getAccoladeDisplayLabel(row) {
  if (isMvpAccolade(row)) return "Most Valuable Player";
  if (isDpoyAccolade(row)) return "Defensive Player of the Year";
  if (isFinalsMvpAccolade(row)) return "Finals MVP";
  if (isSixthManAccolade(row)) return "Sixth Man of the Year";
  if (isMipAccolade(row)) return "Most Improved Player";
  if (isClutchAccolade(row)) return "Clutch Player of the Year";
  if (isRookieAccolade(row)) return "Rookie of the Year";
  if (isChampionAccolade(row)) return "NBA Champion";
  if (isAllStarAccolade(row)) return "NBA All-Star";
  return row?.label || "Accolade";
}

function getAccoladeDisplayType(row) {
  if (isMvpAccolade(row)) return "MVP";
  if (isDpoyAccolade(row)) return "DPOY";
  if (isFinalsMvpAccolade(row)) return "Finals MVP";
  if (isAllNbaAccolade(row)) return "All-NBA";
  if (isAllDefensiveAccolade(row)) return "All-Defense";
  if (isAllRookieAccolade(row)) return "All-Rookie";
  if (isAllStarAccolade(row)) return "All-Star";
  if (isChampionAccolade(row)) return "Champion";
  if (isRookieAccolade(row)) return "ROTY";
  if (isSixthManAccolade(row)) return "Sixth Man";
  if (isMipAccolade(row)) return "MIP";
  if (isClutchAccolade(row)) return "Clutch";
  return String(row?.type || "Other").replaceAll("_", " ");
}

function getAccoladeIcon(row) {
  const type = String(row?.type || "");
  if (isMvpAccolade(row)) return "🏆";
  if (isDpoyAccolade(row)) return "🛡️";
  if (isFinalsMvpAccolade(row)) return "🎖️";
  if (type === "all_nba_first") return "🥇";
  if (type === "all_nba_second") return "🥈";
  if (type === "all_nba_third") return "🥉";
  if (isAllNbaAccolade(row)) return "🏅";
  if (isAllDefensiveAccolade(row)) return "🛡️";
  if (isAllRookieAccolade(row)) return "🌱";
  if (isAllStarAccolade(row)) return "⭐";
  if (isChampionAccolade(row)) return "💍";
  if (isRookieAccolade(row)) return "🌱";
  if (isSixthManAccolade(row)) return "6";
  if (isMipAccolade(row)) return "📈";
  if (isClutchAccolade(row)) return "⏱️";
  return "•";
}

function getAccoladePriority(row) {
  const type = String(row?.type || "");
  if (isMvpAccolade(row)) return 1;
  if (isDpoyAccolade(row)) return 2;
  if (isFinalsMvpAccolade(row)) return 3;
  if (type === "all_nba_first") return 4;
  if (type === "all_nba_second") return 5;
  if (type === "all_nba_third") return 6;
  if (isChampionAccolade(row)) return 7;
  if (isAllStarAccolade(row)) return 8;
  if (isAllDefensiveAccolade(row)) return 9;
  if (isAllRookieAccolade(row)) return 10;
  if (isRookieAccolade(row)) return 11;
  if (isSixthManAccolade(row)) return 12;
  if (isMipAccolade(row)) return 13;
  if (isClutchAccolade(row)) return 14;
  return 40;
}

function classifyAccolade(row) {
  if (isMvpAccolade(row) || isDpoyAccolade(row) || isFinalsMvpAccolade(row) || isRookieAccolade(row) || isSixthManAccolade(row) || isMipAccolade(row) || isClutchAccolade(row)) return "major";
  if (isAllNbaAccolade(row) || isAllDefensiveAccolade(row) || isAllRookieAccolade(row)) return "team";
  if (isAllStarAccolade(row)) return "all_star";
  if (isChampionAccolade(row)) return "champion";
  return "other";
}

const ACCOLADE_FILTERS = [
  { key: "all", label: "All" },
  { key: "major", label: "Major" },
  { key: "team", label: "League Teams" },
  { key: "all_star", label: "All-Star" },
  { key: "champion", label: "Champion" },
];

function matchesAccoladeFilter(row, filter) {
  if (filter === "all") return true;
  return classifyAccolade(row) === filter;
}

function sortAccoladesForDisplay(rows) {
  return [...rows].sort((a, b) => {
    const ay = getAccoladeSeasonYear(a);
    const by = getAccoladeSeasonYear(b);
    if (ay !== by) return by - ay;
    const ap = getAccoladePriority(a);
    const bp = getAccoladePriority(b);
    if (ap !== bp) return ap - bp;
    return getAccoladeDisplayLabel(a).localeCompare(getAccoladeDisplayLabel(b));
  });
}

function buildSeasonHonorIndex(accolades) {
  const map = new Map();
  for (const row of accolades || []) {
    const seasonYear = getAccoladeSeasonYear(row);
    if (!seasonYear) continue;
    if (!map.has(seasonYear)) map.set(seasonYear, []);
    map.get(seasonYear).push(row);
  }
  for (const [seasonYear, rows] of map.entries()) {
    map.set(seasonYear, [...rows].sort((a, b) => getAccoladePriority(a) - getAccoladePriority(b)));
  }
  return map;
}

function groupAccolades(accolades) {
  const groups = new Map();
  for (const row of accolades || []) {
    const type = String(row?.type || "custom");
    const label = getAccoladeDisplayLabel(row);
    const key = `${type}__${label}`;
    const existing = groups.get(key) || {
      key,
      type,
      label,
      displayType: getAccoladeDisplayType(row),
      icon: getAccoladeIcon(row),
      priority: getAccoladePriority(row),
      rows: [],
      years: [],
    };
    const year = getAccoladeSeasonYear(row);
    existing.rows.push(row);
    if (year && !existing.years.includes(year)) existing.years.push(year);
    groups.set(key, existing);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    years: group.years.sort((a, b) => b - a),
    count: group.rows.length,
    latestYear: Math.max(0, ...group.years),
  })).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.latestYear !== b.latestYear) return b.latestYear - a.latestYear;
    return a.label.localeCompare(b.label);
  });
}

function summarizeCareer(seasons) {
  const played = (seasons || []).filter((row) => row?.rowType !== "total" && Number(row?.games || 0) > 0);
  const games = played.reduce((sum, row) => sum + Number(row?.games || 0), 0);
  const weighted = (key) => {
    if (!games) return 0;
    const total = played.reduce((sum, row) => sum + Number(row?.[key] || 0) * Number(row?.games || 0), 0);
    return round1(total / games);
  };
  return {
    seasons: new Set(played.map((row) => row?.seasonYear).filter(Boolean)).size,
    games,
    ppg: weighted("ppg"),
    rpg: weighted("rpg"),
    apg: weighted("apg"),
    latest: played[played.length - 1] || null,
  };
}

function computeMood(player, leagueData, teamName, currentStats) {
  const explicit = player?.mood;
  if (explicit && typeof explicit === "object") {
    const value = clamp(safeNumber(explicit.value, 65), 0, 100);
    return {
      value,
      label: explicit.label || getMoodLabel(value),
      trend: explicit.trend || "stable",
      reasons: Array.isArray(explicit.reasons) && explicit.reasons.length ? explicit.reasons : ["Mood is coming from the saved player profile."],
      source: "saved",
    };
  }

  let score = 66;
  const reasons = [];
  const ovr = safeNumber(player?.overall, 0);
  const pot = safeNumber(player?.potential, 0);
  const age = safeNumber(player?.age, 0);
  const aav = getContractAav(player?.contract);
  const yearsWithTeam = safeNumber(player?.meta?.yearsWithCurrentTeam, 0);
  const latestTeam = getLatestTeamHistory(leagueData, teamName);

  if (latestTeam) {
    const wins = safeNumber(latestTeam.wins, 0);
    if (latestTeam.champion) {
      score += 15;
      reasons.push("Fresh championship glow.");
    } else if (latestTeam.finals) {
      score += 12;
      reasons.push("Coming off a Finals run.");
    } else if (latestTeam.conferenceFinals) {
      score += 9;
      reasons.push("Team made a deep playoff run.");
    } else if (wins >= 50) {
      score += 8;
      reasons.push("Team won 50+ games.");
    } else if (wins >= 42 || latestTeam.madePlayoffs) {
      score += 4;
      reasons.push("Team is competitive.");
    } else if (wins < 28) {
      score -= 9;
      reasons.push("Team struggled badly in the standings.");
    } else if (wins < 35) {
      score -= 5;
      reasons.push("Team missed winning-level results.");
    }
  } else {
    reasons.push("No recent team-results snapshot found yet.");
  }

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const latestSeason = [...seasons].reverse().find((row) => row?.rowType !== "total" && Number(row?.games || 0) > 0);
  const gp = safeNumber(currentStats?.GP ?? latestSeason?.games, 0);
  const ppg = safeNumber(currentStats?.PTS ?? latestSeason?.ppg, 0);

  if (gp >= 70) {
    score += 4;
    reasons.push("Played a major role across the season.");
  } else if (gp >= 55) {
    score += 2;
    reasons.push("Had steady rotation usage.");
  } else if (gp > 0 && gp < 35) {
    score -= 5;
    reasons.push("Limited games played could affect his outlook.");
  }

  if (ovr >= 88 && ppg < 18) {
    score -= 5;
    reasons.push("Star-level rating with lower scoring role.");
  } else if (ovr >= 82 && ppg < 10) {
    score -= 4;
    reasons.push("Starter-level talent with a smaller offensive role.");
  } else if (ppg >= 20) {
    score += 4;
    reasons.push("Getting strong offensive touches.");
  }

  if (aav > 0) {
    if (ovr >= 90 && aav < 30_000_000) {
      score -= 8;
      reasons.push("May feel underpaid for superstar value.");
    } else if (ovr >= 84 && aav < 18_000_000) {
      score -= 6;
      reasons.push("Contract looks light for his rating tier.");
    } else if (aav >= 30_000_000) {
      score += 4;
      reasons.push("Has a major long-term contract.");
    } else if (aav >= 12_000_000) {
      score += 2;
      reasons.push("Contract is respectable for his role.");
    }
  } else {
    score -= 3;
    reasons.push("No active contract security shown.");
  }

  if (yearsWithTeam >= 5) {
    score += 4;
    reasons.push("Strong continuity with current team.");
  } else if (yearsWithTeam >= 3) {
    score += 2;
    reasons.push("Established with current team.");
  } else if (yearsWithTeam <= 1 && teamName !== "Free Agent") {
    score -= 1;
    reasons.push("Still settling into the organization.");
  }

  if (age <= 24 && pot - ovr >= 5) {
    score += 3;
    reasons.push("Young player with a clear growth runway.");
  }

  const value = clamp(Math.round(score), 0, 100);
  return {
    value,
    label: getMoodLabel(value),
    trend: value >= 72 ? "up" : value <= 45 ? "down" : "stable",
    reasons: reasons.slice(0, 5),
    source: "generated",
  };
}

function getOptionYearIndices(option) {
  if (!option || typeof option !== "object") return [];
  const raw = Array.isArray(option.yearIndices)
    ? option.yearIndices
    : option.yearIndex !== undefined && option.yearIndex !== null
    ? [option.yearIndex]
    : [];
  return raw.map((value) => Number(value)).filter((value, index, rows) => Number.isFinite(value) && value >= 0 && rows.indexOf(value) === index).sort((a, b) => a - b);
}

function getOptionPickValue(option, yearIndex) {
  if (!option || typeof option !== "object") return null;
  const picked = option.picked;
  if (picked && typeof picked === "object" && !Array.isArray(picked)) {
    if (String(yearIndex) in picked) return picked[String(yearIndex)];
    if ("default" in picked) return picked.default;
    return null;
  }
  return picked ?? null;
}

function isOptionDecisionWindow(leagueData) {
  const saved = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const embedded = leagueData?.offseasonState || leagueData?.offseason || {};
  const state = Object.keys(saved).length ? saved : embedded;
  return Boolean(state?.active && !state?.optionsComplete && !state?.preFreeAgencyResolved);
}

function isPendingContractOptionYear(contract, yearIndex, currentSeasonYear, optionWindowActive) {
  const option = contract?.option;
  if (!option?.type) return false;
  const normalizedYearIndex = Number(yearIndex);
  if (!getOptionYearIndices(option).includes(normalizedYearIndex)) return false;
  const pickedValue = getOptionPickValue(option, normalizedYearIndex);
  if (pickedValue !== null && pickedValue !== undefined) return false;
  const optionSeasonYear = safeNumber(contract?.startYear, 0) + normalizedYearIndex;
  if (optionSeasonYear > currentSeasonYear) return true;
  return optionSeasonYear === currentSeasonYear && optionWindowActive;
}

function getContractOptionInfo(contract, yearIndex, currentSeasonYear, optionWindowActive) {
  const option = contract?.option;
  if (!option?.type) return null;

  const normalizedYearIndex = Number(yearIndex);
  if (!getOptionYearIndices(option).includes(normalizedYearIndex)) return null;

  const rawType = String(option.type || "").toLowerCase().replaceAll("_", " ");
  const isTeam = rawType.includes("team");
  const isPlayer = rawType.includes("player");
  const pickedValue = getOptionPickValue(option, normalizedYearIndex);
  const seasonYear = safeNumber(contract?.startYear, 0) + normalizedYearIndex;
  const pending = (pickedValue === null || pickedValue === undefined) && (seasonYear > currentSeasonYear || (seasonYear === currentSeasonYear && optionWindowActive));

  return {
    type: isTeam ? "team" : isPlayer ? "player" : rawType || "option",
    label: isTeam ? "Team option" : isPlayer ? "Player option" : `${rawType || "Contract"} option`,
    tone: isTeam ? "blue" : "green",
    pending,
    picked: pickedValue,
  };
}

function contractOptionRowClass(optionInfo) {
  if (!optionInfo) return "border-white/15 bg-black/20";
  if (optionInfo.tone === "blue") return "border-sky-400/35 bg-sky-500/10 shadow-[0_0_16px_rgba(56,189,248,0.08)]";
  return "border-emerald-400/35 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.08)]";
}

function contractOptionTextClass(optionInfo) {
  if (!optionInfo) return "text-zinc-300";
  if (optionInfo.tone === "blue") return "text-sky-200";
  return "text-emerald-200";
}

function Chip({ children, tone = "neutral" }) {
  const classes =
    tone === "green"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : tone === "red"
      ? "border-red-400/25 bg-red-400/10 text-red-200"
      : tone === "orange"
      ? "border-orange-400/25 bg-orange-400/10 text-orange-200"
      : tone === "blue"
      ? "border-sky-400/25 bg-sky-400/10 text-sky-200"
      : "border-white/10 bg-white/[0.05] text-zinc-200";

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${classes}`}>{children}</span>;
}

function StatPill({ label, value, accent = false, compact = false }) {
  return (
    <div className={`pc-stat-pill rounded-2xl border border-white/15 bg-white/[0.04] ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`${compact ? "mt-0.5 text-base" : "mt-1 text-xl"} font-black ${accent ? "text-orange-300" : "text-white"}`}>{value ?? "-"}</div>
    </div>
  );
}

function EmptyState({ title, subtitle }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
      <div className="text-lg font-black text-white">{title}</div>
      {subtitle && <div className="mt-2 text-sm text-zinc-400">{subtitle}</div>}
    </div>
  );
}

function MiniOverallPill({ value, potential, circumference, offset }) {
  return (
    <div className="pc-overall-ring relative grid h-[124px] w-[124px] shrink-0 place-items-center rounded-full bg-black/10">
      <svg viewBox="0 0 126 126" className="absolute h-[124px] w-[124px] -rotate-90">
        <circle cx="63" cy="63" r="52" stroke="rgba(255,255,255,0.10)" strokeWidth="9" fill="none" />
        <circle cx="63" cy="63" r="52" stroke="url(#miniPlayerCardOvrGradient)" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
        <defs>
          <linearGradient id="miniPlayerCardOvrGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fef08a" />
          </linearGradient>
        </defs>
      </svg>
      <div className="relative text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">OVR</div>
        <div className="-mt-0.5 text-[44px] font-black leading-none text-orange-300">{value ?? "-"}</div>
        <div className="mt-1 text-[10px] font-black uppercase tracking-[0.17em] text-zinc-500">POT {potential ?? "-"}</div>
      </div>
    </div>
  );
}

function HeaderInfoPill({ label, value, children, wide = false }) {
  const normalizedLabel = String(label || "").toLowerCase();
  const sizeClass = wide ? "min-w-[300px] flex-[2]" : normalizedLabel === "pos" ? "w-[110px] min-w-[110px]" : "w-[90px] min-w-[90px]";
  return (
    <div className={`pc-stat-pill flex h-[78px] flex-col justify-center rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 ${sizeClass}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1.5 min-w-0 text-lg font-black text-white">{children || value || "-"}</div>
    </div>
  );
}

function HeaderTeamPill({ teamName, teamLogo }) {
  return (
    <HeaderInfoPill label="Team" wide>
      <div className="flex min-w-0 items-center gap-3">
        {teamLogo ? <img src={teamLogo} alt={teamName} className="h-8 w-8 shrink-0 object-contain" /> : <div className="h-8 w-8 shrink-0 rounded-full bg-white/[0.05]" />}
        <span className="min-w-0 truncate whitespace-nowrap text-sm font-black text-white sm:text-base">{teamName || "Free Agent"}</span>
      </div>
    </HeaderInfoPill>
  );
}

function HonorCell({ honors, honorKey, isOpen, onToggle }) {
  if (!honors?.length) return <span className="text-zinc-700">—</span>;
  const visible = honors.slice(0, 3);
  const extraCount = honors.length - visible.length;
  return (
    <div className="relative inline-flex items-center" data-honor-popup-root="true">
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-sm transition hover:border-orange-400/30 hover:bg-orange-500/10" aria-expanded={isOpen} aria-label={`View ${honors.length} honors for ${honorKey}`}>
        {visible.map((row, index) => <span key={`${getAccoladeIcon(row)}-${index}`} title={row?.label || "Honor"}>{getAccoladeIcon(row)}</span>)}
        {extraCount > 0 && <span className="ml-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-black text-orange-200">+{extraCount}</span>}
      </button>
      {isOpen && (
        <div className="absolute left-0 top-9 z-50 w-72 rounded-2xl border border-orange-400/25 bg-zinc-950 p-3 text-left shadow-2xl shadow-black/60">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Season Honors</div>
          <div className="pc-modal-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
            {honors.map((row, index) => (
              <div key={`${row?.label}-${index}`} className="flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
                <span className="mt-0.5 w-5 text-center">{getAccoladeIcon(row)}</span>
                <div className="min-w-0">
                  <div className="text-xs font-black text-white">{getAccoladeDisplayLabel(row)}</div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{getAccoladeDisplayType(row)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AttributeCompareRow({ label, value, average, compact = false }) {
  const diff = value - average;
  const diffLabel = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} vs avg`;
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/25 ${compact ? "p-2.5" : "p-3"}`}>
      <div className={`${compact ? "mb-1.5" : "mb-2"} flex items-center justify-between gap-3`}>
        <div className="text-xs font-black uppercase tracking-[0.16em] text-zinc-400">{label}</div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-white">{value || "-"}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${diff >= 0 ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-red-400/25 bg-red-400/10 text-red-200"}`}>{diffLabel}</span>
        </div>
      </div>
      <div className={`${compact ? "h-2.5" : "h-3"} relative overflow-hidden rounded-full bg-white/[0.07]`}>
        <div className="absolute bottom-0 top-0 w-px bg-white/60" style={{ left: `${clamp(average, 0, 99)}%` }} title={`League avg ${average.toFixed(1)}`} />
        <div className="h-full rounded-full bg-gradient-to-r from-orange-600 via-orange-400 to-amber-300" style={{ width: `${clamp(value, 0, 99)}%` }} />
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
          <span>0</span>
          <span>Avg {average.toFixed(1)}</span>
          <span>99</span>
        </div>
      )}
    </div>
  );
}


const TREND_SERIES = [
  { key: "ppg", label: "Points", shortLabel: "PPG", color: "#f97316" },
  { key: "rpg", label: "Rebounds", shortLabel: "RPG", color: "#60a5fa" },
  { key: "apg", label: "Assists", shortLabel: "APG", color: "#4ade80" },
];

function formatSeasonLabel(seasonYear) {
  const endYear = Number(seasonYear || 0);
  if (!Number.isFinite(endYear) || endYear < 1901) return "—";
  return `${endYear - 1}-${String(endYear).slice(-2)}`;
}

function getTrendRows(seasons) {
  return (seasons || [])
    .filter((row) => row && row?.rowType !== "total" && Number(row?.games ?? row?.gp ?? 0) > 0)
    .sort((a, b) => Number(a?.seasonYear || 0) - Number(b?.seasonYear || 0))
    .slice(-10);
}

function CompactDataRow({ label, value, accent = false, subdued = false, tone = "default" }) {
  const toneClass = tone === "green"
    ? "text-emerald-300"
    : tone === "red"
      ? "text-red-300"
      : accent
        ? "text-orange-300"
        : subdued
          ? "text-zinc-500"
          : "text-zinc-100";

  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-white/[0.055] py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-[12px] font-medium text-zinc-400">{label}</span>
      <span className={`shrink-0 text-[12px] font-semibold ${toneClass}`}>{value ?? "—"}</span>
    </div>
  );
}

const OVERVIEW_ATTRIBUTE_GROUPS = [
  { label: "Athleticism", keys: ["SPEED", "ATH"] },
  { label: "Scoring", keys: ["3PT", "MID", "CLOSE", "FT", "OIQ"] },
  { label: "Rebounding", keys: ["REB"] },
  { label: "Defense", keys: ["PER D", "INS D", "BLK", "STL", "DIQ"] },
  { label: "Playmaking", keys: ["BALL", "PASS", "OIQ"] },
];

function buildOverviewAttributeGroups(attributeRows) {
  const byLabel = new Map((attributeRows || []).map((row) => [row?.label, safeNumber(row?.value, 0)]));
  return OVERVIEW_ATTRIBUTE_GROUPS.map((group) => {
    const values = group.keys
      .map((key) => byLabel.get(key))
      .filter((value) => Number.isFinite(value) && value > 0);

    const value = values.length
      ? Math.round(values.reduce((sum, current) => sum + current, 0) / values.length)
      : 0;

    return { label: group.label, value };
  });
}

function getPlayerDraftYear(player) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const candidates = [
    meta?.draftYear,
    meta?.draftSeasonYear,
    player?.draftYear,
    player?.draftClassYear,
    player?.draftedYear,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1900 && value <= 2200) return Math.trunc(value);
  }

  return null;
}

function getPlayerExperienceYears(player, seasons) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const candidates = [
    meta?.proSeasons,
    player?.proSeasons,
    player?.seasonsPro,
    player?.yearsPro,
    player?.yearsOfExperience,
    player?.yoe,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0 && value <= 40) return Math.trunc(value);
  }

  const trackedYears = new Set(
    (seasons || [])
      .filter((row) => row && row?.rowType !== "total" && Number(row?.games ?? row?.gp ?? 0) > 0)
      .map((row) => Number(row?.seasonYear || 0))
      .filter((year) => Number.isFinite(year) && year > 0)
  );

  return trackedYears.size || null;
}

function getPlayerInjuryStatus(player) {
  const injury = player?.injury;
  if (!injury || typeof injury !== "object" || injury.active === false) {
    return { label: "Healthy", tone: "green" };
  }

  const detail = [
    injury?.name,
    injury?.label,
    injury?.type,
    injury?.description,
  ].find((candidate) => typeof candidate === "string" && candidate.trim());

  return {
    label: detail ? detail.trim() : "Injured",
    tone: "red",
  };
}

function CompactAttributeBar({ label, value }) {
  const safeValue = clamp(safeNumber(value, 0), 0, 99);
  return (
    <div className="grid grid-cols-[112px_34px_minmax(0,1fr)] items-center gap-3 py-[5px]">
      <span className="truncate text-[12px] font-medium text-zinc-300">{label}</span>
      <span className="text-right text-[12px] font-semibold text-orange-300">{safeValue || "—"}</span>
      <div className="h-[6px] overflow-hidden rounded-full bg-white/[0.075]">
        <div className="h-full rounded-full bg-gradient-to-r from-orange-600 via-orange-400 to-amber-300" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function PerformanceTrendsChart({ seasons }) {
  const rows = getTrendRows(seasons);
  if (!rows.length) {
    return (
      <div className="grid min-h-[220px] place-items-center rounded-[18px] border border-white/[0.07] bg-black/20 px-6 text-center">
        <div>
          <div className="text-sm font-semibold text-zinc-200">No performance trend yet</div>
          <div className="mt-1 text-xs text-zinc-500">A trend appears after the player has a completed or active season with games played.</div>
        </div>
      </div>
    );
  }

  const width = 760;
  const height = 220;
  const margin = { left: 38, right: 20, top: 20, bottom: 36 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const allValues = rows.flatMap((row) => TREND_SERIES.map((series) => Math.max(0, safeNumber(row?.[series.key], 0))));
  const rawMax = Math.max(5, ...allValues);
  const yMax = Math.max(5, Math.ceil(rawMax / 5) * 5);
  const xForIndex = (index) => rows.length === 1
    ? margin.left + plotWidth / 2
    : margin.left + (index / (rows.length - 1)) * plotWidth;
  const yForValue = (value) => margin.top + (1 - clamp(safeNumber(value, 0) / yMax, 0, 1)) * plotHeight;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: Math.round(yMax * ratio),
    y: margin.top + (1 - ratio) * plotHeight,
  }));
  const latest = rows[rows.length - 1];

  return (
    <div className="rounded-[18px] border border-white/[0.07] bg-black/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {TREND_SERIES.map((series) => (
            <div key={series.key} className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
              {series.label}
            </div>
          ))}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
          {rows.length === 1 ? "1 season" : `${rows.length} seasons`}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_118px]">
        <div className="min-w-0">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[210px] w-full overflow-visible"
            role="img"
            aria-label="Player points, rebounds, and assists trend by season"
          >
            {yTicks.map((tick) => (
              <g key={tick.value}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="rgba(255,255,255,0.075)"
                  strokeDasharray="3 5"
                />
                <text
                  x={margin.left - 10}
                  y={tick.y + 4}
                  fill="rgba(161,161,170,0.78)"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily='Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                >
                  {tick.value}
                </text>
              </g>
            ))}

            {TREND_SERIES.map((series) => {
              const points = rows.map((row, index) => `${xForIndex(index)},${yForValue(row?.[series.key])}`).join(" ");
              return (
                <g key={series.key}>
                  {rows.length > 1 && (
                    <polyline
                      fill="none"
                      stroke={series.color}
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={points}
                    />
                  )}
                  {rows.map((row, index) => (
                    <circle
                      key={`${series.key}-${row?.seasonYear}-${index}`}
                      cx={xForIndex(index)}
                      cy={yForValue(row?.[series.key])}
                      r="3.8"
                      fill={series.color}
                      stroke="#0b0d10"
                      strokeWidth="1.5"
                    />
                  ))}
                </g>
              );
            })}

            {rows.map((row, index) => {
              const showLabel = rows.length <= 6 || index % 2 === 0 || index === rows.length - 1;
              if (!showLabel) return null;
              return (
                <text
                  key={`season-${row?.seasonYear}-${index}`}
                  x={xForIndex(index)}
                  y={height - 10}
                  fill="rgba(161,161,170,0.82)"
                  fontSize="10"
                  textAnchor="middle"
                  fontFamily='Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                >
                  {formatSeasonLabel(row?.seasonYear)}
                </text>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-col justify-center border-t border-white/[0.06] pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{formatSeasonLabel(latest?.seasonYear)}</div>
          <div className="mt-2 space-y-2">
            {TREND_SERIES.map((series) => (
              <div key={series.key}>
                <div className="text-[22px] font-semibold leading-none" style={{ color: series.color }}>
                  {safeNumber(latest?.[series.key], 0).toFixed(1)}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-zinc-500">{series.shortLabel}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlayerCardModal({
  open,
  player: playerReference,
  team,
  teamName,
  teamLogo,
  leagueData,
  currentStats,
  onClose,
}) {
  const player = useMemo(() => getCanonicalPlayer(leagueData, playerReference), [leagueData, playerReference]);
  const [activeTab, setActiveTab] = useState("overview");
  const [accoladeFilter, setAccoladeFilter] = useState("all");
  const [openHonorKey, setOpenHonorKey] = useState(null);
  const contentRootRef = useRef(null);

  const resolvedTeamName = useMemo(() => getPrimaryTeamName(player, player?.teamName || team?.name || teamName), [player, team?.name, teamName]);
  const resolvedTeamLogo = useMemo(() => getPrimaryTeamLogo(player, getTeamLogoIndex(leagueData)[resolvedTeamName] || (resolvedTeamName === "Free Agent" ? "" : team?.logo || teamLogo), leagueData, resolvedTeamName), [player, team?.logo, teamLogo, leagueData, resolvedTeamName]);
  const mood = useMemo(() => computeMood(player, leagueData, resolvedTeamName, currentStats), [player, leagueData, resolvedTeamName, currentStats]);
  const seasons = useMemo(() => player ? buildPlayerCardSeasonRows({ player, leagueData, resolvedTeamName, resolvedTeamLogo }) : [], [player, leagueData, resolvedTeamName, resolvedTeamLogo]);
  const accolades = useMemo(() => player ? buildPlayerCardAccolades({ player, leagueData, resolvedTeamName }) : [], [player, leagueData, resolvedTeamName]);
  const honorIndex = useMemo(() => buildSeasonHonorIndex(accolades), [accolades]);
  const filteredAccolades = useMemo(() => sortAccoladesForDisplay(accolades.filter((row) => matchesAccoladeFilter(row, accoladeFilter))), [accolades, accoladeFilter]);
  const groupedAccolades = useMemo(() => groupAccolades(filteredAccolades), [filteredAccolades]);
  const allGroupedAccolades = useMemo(() => groupAccolades(accolades), [accolades]);
  const leagueAttributeAverages = useMemo(() => buildLeagueAttributeAverages(leagueData), [leagueData]);
  const attributeRows = useMemo(() => ATTR_LABELS.map((label, index) => ({
    label,
    value: safeNumber(player?.attrs?.[index], 0),
    average: safeNumber(leagueAttributeAverages[index], 0),
  })), [player, leagueAttributeAverages]);
  const careerSummary = useMemo(() => summarizeCareer(seasons), [seasons]);
  const overviewAttributes = useMemo(() => buildOverviewAttributeGroups(attributeRows), [attributeRows]);

  useEffect(() => {
    if (!open) return;
    setActiveTab("overview");
    setAccoladeFilter("all");
    setOpenHonorKey(null);
  }, [open, player?.id, player?.name]);

  useEffect(() => {
    if (!open) return;
    setOpenHonorKey(null);
    if (contentRootRef.current) contentRootRef.current.scrollTop = 0;
  }, [activeTab, open]);

  useEffect(() => {
    if (!open || !openHonorKey) return undefined;
    const onPointerDown = (event) => {
      if (event.target?.closest?.('[data-honor-popup-root="true"]')) return;
      setOpenHonorKey(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, openHonorKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || !player) return null;

  const resolvedContractType = getContractType(player);
  const isTwoWayDevelopmentContract = resolvedContractType === "two_way" || resolvedContractType === "two-way";
  const isNonCapDevelopmentContract = isTwoWayDevelopmentContract || ["stash", "stashed", "draft_stash", "g_league_stash", "overseas_stash"].includes(resolvedContractType);
  const twoWayYearsUsed = isTwoWayDevelopmentContract ? Math.max(1, safeNumber(player?.twoWayMeta?.twoWayYearsUsed ?? player?.twoWayYearsUsed, 1)) : 0;
  const maxTwoWayYears = isTwoWayDevelopmentContract ? Math.max(twoWayYearsUsed, safeNumber(player?.twoWayMeta?.maxTwoWayYears ?? player?.maxTwoWayYears, 3)) : 0;
  const developmentYearsLabel = isTwoWayDevelopmentContract ? `Year ${twoWayYearsUsed} of ${maxTwoWayYears}` : "Development";
  const remainingContract = isNonCapDevelopmentContract
    ? { rows: [], years: 0, aav: 0, displayStartYear: null }
    : getRemainingContractView(player?.contract, leagueData);
  const salaryByYear = remainingContract.rows;
  const contractYears = remainingContract.years;
  const contractAav = remainingContract.aav;
  const contractDisplayStartYear = remainingContract.displayStartYear;
  const moodTheme = MOOD_COLORS[mood.label] || MOOD_COLORS.Content;
  const option = player?.contract?.option;
  const optionType = option?.type ? String(option.type).replaceAll("_", " ") : null;
  const contractDisplaySeasonYear = getCurrentSeasonDisplayYear(leagueData);
  const optionWindowActive = isOptionDecisionWindow(leagueData);
  const rights = player?.rights || {};
  const portraitUrl = getPlayerPortraitUrl(player);
  const contractTypeLabel = getContractTypeLabel(player);
  const contractTypeTone = getContractTypeTone(player);
  const assignmentLabel = getAssignmentLabel(player);
  const fillPercent = clamp(safeNumber(player?.overall, 0) / 99, 0, 1);
  const latestSeason = careerSummary.latest;
  const featuredAccolades = allGroupedAccolades.slice(0, 4);
  const contractTotalRemaining = salaryByYear.reduce((sum, row) => sum + safeNumber(row?.salary, 0), 0);
  const contractFreeAgencyYear = salaryByYear.length ? Number(salaryByYear[salaryByYear.length - 1]?.seasonYear || 0) + 1 : null;
  const draftYear = getPlayerDraftYear(player);
  const experienceYears = getPlayerExperienceYears(player, seasons);
  const injuryStatus = getPlayerInjuryStatus(player);

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-3 py-3 sm:px-6">
      {/* PLAYER CARD PASS 29: flat identity header + clean attributes/contract */}
      <style>{`
        .pc-player-card { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .pc-modal-scroll { scrollbar-width: thin; scrollbar-color: #f97316 #111111; }
        .pc-modal-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
        .pc-modal-scroll::-webkit-scrollbar-track { background: #111111; border-radius: 9999px; }
        .pc-modal-scroll::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #fb923c, #c2410c); border-radius: 9999px; border: 2px solid #111111; }
        .pc-glow-card { box-shadow: 0 22px 64px rgba(0,0,0,0.54), 0 0 28px rgba(229,231,235,0.045); }
        .pc-soft-border { box-shadow: 0 0 0 1px rgba(255,255,255,0.035), 0 0 16px rgba(229,231,235,0.055); }
        .pc-stat-pill { box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 0 13px rgba(229,231,235,0.055); }
        .pc-face-card { box-shadow: 0 0 18px rgba(229,231,235,0.07), inset 0 1px 0 rgba(255,255,255,0.035); }
        .pc-hero-face { width: 178px; height: 174px; }

        /* PASS 29.1: critical geometry lives in plain CSS so HMR/Tailwind scanning cannot drop it. */
        .pc29-card {
          width: min(920px, calc(100vw - 36px));
          height: min(650px, 88dvh);
          max-height: calc(100dvh - 24px);
        }
        .pc29-hero {
          position: relative;
          display: grid;
          grid-template-columns: 232px minmax(0, 1fr) 126px;
          align-items: stretch;
          min-height: 176px;
          padding: 0 46px 0 14px;
          overflow: hidden;
          border-top: 2px solid rgba(161, 161, 170, 0.48);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: #101318;
        }
        .pc29-portrait-zone { position: relative; min-width: 0; height: 174px; align-self: end; overflow: hidden; }
        .pc29-watermark {
          pointer-events: none;
          position: absolute;
          left: 44%;
          top: 51%;
          width: 172px;
          height: 172px;
          transform: translate(-50%, -50%);
          object-fit: contain;
          opacity: 0.07;
          filter: saturate(0.92) brightness(0.72) contrast(1.08);
        }
        .pc29-portrait { position: absolute !important; inset: auto 0 0 0 !important; width: 100% !important; height: 170px !important; z-index: 2; }
        .pc29-identity { min-width: 0; align-self: center; padding: 18px 14px 14px 2px; }
        .pc29-name { margin: 0; color: white; font-size: 32px; line-height: 0.98; font-weight: 700; letter-spacing: -0.03em; }
        .pc29-teamline { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 9px; }
        .pc29-teamline img { width: 24px; height: 24px; flex: 0 0 auto; object-fit: contain; }
        .pc29-teamname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e4e4e7; font-size: 14px; font-weight: 650; }
        .pc29-meta { display: grid; grid-template-columns: 86px 68px 82px minmax(120px,1fr); margin-top: 14px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,0.07); }
        .pc29-meta-cell { min-width: 0; padding-right: 10px; }
        .pc29-meta-cell + .pc29-meta-cell { padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.065); }
        .pc29-meta-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #71717a; font-size: 9px; font-weight: 550; text-transform: uppercase; letter-spacing: 0.08em; }
        .pc29-meta-value { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f4f4f5; font-size: 12px; font-weight: 650; }
        .pc29-rating { display: grid; place-items: center; align-self: center; justify-self: end; }
        .pc29-rating .pc-overall-ring { width: 116px !important; height: 116px !important; }
        .pc29-rating .pc-overall-ring > svg { width: 116px !important; height: 116px !important; }
        .pc29-close { position: absolute; right: 12px; top: 12px; z-index: 5; display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; background: rgba(0,0,0,0.20); color: #a1a1aa; font-size: 18px; font-weight: 500; }
        .pc29-close:hover { background: rgba(255,255,255,0.06); color: white; }

        .pc29-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .pc29-attribute-panel { overflow: hidden; border: 1px solid rgba(255,255,255,0.075); border-radius: 16px; background: rgba(255,255,255,0.02); }
        .pc29-attribute-columns, .pc29-attribute-row { display: grid; grid-template-columns: 180px 52px minmax(150px,1fr) 104px; align-items: center; gap: 12px; }
        .pc29-attribute-columns { padding: 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #71717a; font-size: 9px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.10em; }
        .pc29-attribute-row { min-height: 36px; padding: 6px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .pc29-attribute-row:last-child { border-bottom: 0; }
        .pc29-attribute-label { color: #d4d4d8; font-size: 11px; font-weight: 550; }
        .pc29-attribute-rating { text-align: right; color: #fdba74; font-size: 12px; font-weight: 700; }
        .pc29-attribute-bar { position: relative; height: 7px; border-radius: 999px; background: rgba(255,255,255,0.075); }
        .pc29-attribute-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg,#ea580c,#fb923c,#fde68a); }
        .pc29-attribute-average { position: absolute; top: 50%; width: 1px; height: 13px; transform: translateY(-50%); background: rgba(244,244,245,0.82); }
        .pc29-delta { justify-self: end; min-width: 84px; border: 1px solid rgba(255,255,255,0.07); border-radius: 999px; padding: 3px 7px; text-align: center; font-size: 9px; font-weight: 700; }
        .pc29-delta.pos { border-color: rgba(52,211,153,0.20); background: rgba(16,185,129,0.08); color: #6ee7b7; }
        .pc29-delta.neg { border-color: rgba(248,113,113,0.20); background: rgba(239,68,68,0.07); color: #fca5a5; }
        .pc29-delta.neutral { color: #71717a; }

        .pc29-contract-grid { display: grid; grid-template-columns: minmax(0,0.96fr) minmax(0,1.04fr); gap: 12px; }
        .pc29-contract-panel { border: 1px solid rgba(255,255,255,0.075); border-radius: 16px; background: rgba(255,255,255,0.022); padding: 14px; }
        .pc29-contract-title { margin-bottom: 7px; color: #f4f4f5; font-size: 15px; font-weight: 650; }
        .pc29-rights { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.07); }
        .pc29-rights-label { margin-bottom: 7px; color: #71717a; font-size: 9px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.11em; }
        .pc29-rights-list { display: flex; flex-wrap: wrap; gap: 7px; }
        .pc29-right-chip { border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; background: rgba(255,255,255,0.035); padding: 5px 9px; color: #d4d4d8; font-size: 10px; font-weight: 600; }
        .pc29-salary-head, .pc29-salary-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
        .pc29-salary-head { padding: 7px 0 8px; border-bottom: 1px solid rgba(255,255,255,0.08); color: #71717a; font-size: 9px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.1em; }
        .pc29-salary-row { min-height: 38px; border-bottom: 1px solid rgba(255,255,255,0.055); color: #d4d4d8; font-size: 11px; }
        .pc29-salary-row:last-child { border-bottom: 0; }
        .pc29-salary-amount { color: #f4f4f5; font-weight: 650; }

        @media (max-width: 760px) {
          .pc29-card { width: calc(100vw - 18px); height: min(670px, 94dvh); }
          .pc29-hero { grid-template-columns: 150px minmax(0,1fr); min-height: 166px; padding-left: 4px; padding-right: 40px; }
          .pc29-portrait-zone { height: 164px; }
          .pc29-portrait { height: 160px !important; }
          .pc29-rating { display: none; }
          .pc29-name { font-size: 26px; }
          .pc29-meta { grid-template-columns: 1fr 1fr; row-gap: 6px; }
          .pc29-meta-cell:nth-child(3) { padding-left: 0; border-left: 0; }
          .pc29-attribute-columns, .pc29-attribute-row { grid-template-columns: 120px 38px minmax(90px,1fr) 76px; gap: 7px; padding-left: 10px; padding-right: 10px; }
          .pc29-attribute-label { font-size: 10px; }
          .pc29-delta { min-width: 68px; font-size: 8px; }
          .pc29-contract-grid { grid-template-columns: 1fr; }
        }
        @media (max-height: 700px) and (min-width: 641px) {
          .pc29-card { height: 92dvh; }
          .pc29-hero { min-height: 156px; grid-template-columns: 210px minmax(0,1fr) 112px; }
          .pc29-portrait-zone { height: 154px; }
          .pc29-portrait { height: 150px !important; }
          .pc29-name { font-size: 29px; }
          .pc29-rating .pc-overall-ring, .pc29-rating .pc-overall-ring > svg { width: 104px !important; height: 104px !important; }
        }
        .pc-shimmer { background: linear-gradient(110deg, rgba(255,255,255,0.05), rgba(251,146,60,0.16), rgba(255,255,255,0.05)); background-size: 260% 100%; animation: pc-shimmer 7s ease-in-out infinite; }
        @keyframes pc-shimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes pc-pop { from { opacity: 0; transform: translateY(18px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .pc-pop { animation: pc-pop 180ms ease-out both; }
      `}</style>

      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/58" style={{ backdropFilter: "blur(1.5px)", WebkitBackdropFilter: "blur(1.5px)" }} />

      <div data-bm-sfx-scope="player-card" className="pc-player-card pc29-card pc-pop pc-glow-card relative flex flex-col overflow-hidden rounded-[20px] border border-white/[0.10] bg-[#090b0e] text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-24 top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-44 w-[70%] -translate-x-1/2 bg-orange-500/5 blur-3xl" />
        </div>

        {/* PASS 29.1: roster-style identity header with CSS-stable geometry */}
        <div className="pc29-hero">
          <div className="pc29-portrait-zone">
            {resolvedTeamLogo && <img src={resolvedTeamLogo} alt="" className="pc29-watermark" />}
            <RuntimePlayerPortrait
              player={player}
              team={team}
              teamName={resolvedTeamName}
              src={portraitUrl}
              alt={player?.name || "Player"}
              className="pc29-portrait"
              contentStyle={{ transform: "translateY(4px) scale(1.22)", transformOrigin: "bottom center" }}
              fallback={<div className="relative z-10 flex h-full w-full items-end justify-center pb-5 text-sm font-semibold text-zinc-500">No Image</div>}
            />
          </div>

          <div className="pc29-identity">
            <h2 className="pc29-name">{player?.name || "Unknown Player"}</h2>
            <div className="pc29-teamline">
              {resolvedTeamLogo ? <img src={resolvedTeamLogo} alt={resolvedTeamName} /> : null}
              <span className="pc29-teamname">{resolvedTeamName || "Free Agent"}</span>
              {assignmentLabel && <span className="text-[10px] font-semibold uppercase tracking-[0.10em] text-zinc-500">· {assignmentLabel}</span>}
              {rights?.restrictedFreeAgent && <span className="text-[10px] font-semibold uppercase tracking-[0.10em] text-emerald-300">RFA</span>}
            </div>

            <div className="pc29-meta">
              {[
                ["Position", `${player?.pos || "-"}${player?.secondaryPos ? ` / ${player.secondaryPos}` : ""}`],
                ["Age", player?.age ?? "-"],
                ["Height", formatHeight(player?.height)],
                ["Contract", contractTypeLabel],
              ].map(([label, value]) => (
                <div key={label} className="pc29-meta-cell">
                  <div className="pc29-meta-label">{label}</div>
                  <div className="pc29-meta-value">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="pc29-rating">
            <MiniOverallPill value={player?.overall ?? "-"} potential={player?.potential ?? "-"} circumference={2 * Math.PI * 52} offset={(2 * Math.PI * 52) * (1 - fillPercent)} />
          </div>

          <button type="button" onClick={onClose} className="pc29-close" aria-label="Close">×</button>
        </div>

        <div ref={contentRootRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-4 sm:pb-4">
          <div className="mb-3 shrink-0 border-b border-white/[0.08]">
            <div className="pc-modal-scroll flex gap-6 overflow-x-auto">
              {TABS.map((tab) => {
                const badge = tab.key === "career" ? seasons.length : tab.key === "accolades" ? allGroupedAccolades.length : null;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative shrink-0 border-b-2 px-0 py-2.5 text-[12px] font-medium transition ${activeTab === tab.key ? "border-orange-500 text-zinc-50" : "border-transparent text-zinc-400 hover:text-zinc-100"}`}
                  >
                    <span>{tab.label}</span>
                    {badge !== null && <span className="ml-1.5 text-[10px] text-zinc-600">{badge}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab === "overview" && (
              <div className="pc-modal-scroll grid h-full min-h-0 gap-3 overflow-y-auto pr-1 lg:grid-cols-2">
                <div className="h-full rounded-[18px] border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <h3 className="mb-2 text-[15px] font-semibold text-zinc-100">Snapshot</h3>
                  <div>
                    <CompactDataRow label="Draft Year" value={draftYear || "—"} />
                    <CompactDataRow label="Injury Status" value={injuryStatus.label} tone={injuryStatus.tone} />
                    <CompactDataRow label="Experience" value={experienceYears !== null ? `${experienceYears} year${experienceYears === 1 ? "" : "s"}` : "—"} />
                    <CompactDataRow label="Contract Expires" value={contractFreeAgencyYear || "—"} />
                  </div>
                </div>

                <div className="h-full rounded-[18px] border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <h3 className="mb-2 text-[15px] font-semibold text-zinc-100">Contract Summary</h3>
                  <div>
                    <CompactDataRow label="Contract Type" value={contractTypeLabel} />
                    <CompactDataRow label="Years Remaining" value={isNonCapDevelopmentContract ? developmentYearsLabel : contractYears ? `${contractYears} years` : "No active deal"} />
                    <CompactDataRow label="Total Remaining" value={isNonCapDevelopmentContract ? "No cap" : contractTotalRemaining > 0 ? formatMillions(contractTotalRemaining) : "—"} />
                    <CompactDataRow label="Annual Salary" value={isNonCapDevelopmentContract ? "No cap" : contractAav > 0 ? formatMillions(contractAav) : "—"} accent />
                    <CompactDataRow label="Free Agency" value={contractFreeAgencyYear || "—"} />
                    {optionType && <CompactDataRow label="Option" value={optionType} />}
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <h3 className="mb-2 text-[15px] font-semibold text-zinc-100">Top Attributes</h3>
                  <div className="space-y-0.5">
                    {overviewAttributes.map((row) => <CompactAttributeBar key={row.label} label={row.label} value={row.value} />)}
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-zinc-100">Trophy Case</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">{accolades.length} honors</span>
                  </div>
                  {featuredAccolades.length ? (
                    <div className="grid grid-cols-2 gap-2">
                      {featuredAccolades.map((group) => (
                        <div key={group.key} className="rounded-[12px] border border-white/[0.06] bg-black/20 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-semibold text-zinc-100">{group.label}</div>
                              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.10em] text-zinc-500">{group.years.join(", ") || "—"}</div>
                            </div>
                            <div className="text-sm opacity-80">{group.icon}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-[92px] place-items-center text-center">
                      <div>
                        <div className="text-[12px] font-medium text-zinc-400">No accolades yet</div>
                        <div className="mt-1 text-[10px] text-zinc-600">Awards and honors will appear here.</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "attributes" && (
              <div className="pc-modal-scroll h-full overflow-y-auto pr-1">
                <div className="pc29-section-head">
                  <div>
                    <h3 className="text-[16px] font-semibold text-zinc-100">Attributes vs League Average</h3>
                    <div className="mt-0.5 text-[10px] text-zinc-500">Every value is the player&apos;s real rating; the marker and delta use the current league average.</div>
                  </div>
                  <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-600">{attributeRows.length} ratings</div>
                </div>

                <div className="pc29-attribute-panel">
                  <div className="pc29-attribute-columns">
                    <span>Attribute</span>
                    <span style={{ textAlign: "right" }}>Rating</span>
                    <span>Player / League Average</span>
                    <span style={{ textAlign: "right" }}>Vs Avg</span>
                  </div>
                  {attributeRows.map((row) => {
                    const value = clamp(safeNumber(row?.value, 0), 0, 99);
                    const average = clamp(safeNumber(row?.average, 0), 0, 99);
                    const hasAverage = average > 0;
                    const diff = hasAverage ? value - average : 0;
                    const deltaClass = !hasAverage ? "neutral" : diff >= 0 ? "pos" : "neg";
                    const deltaLabel = hasAverage ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} vs avg` : "No avg";
                    return (
                      <div key={row.label} className="pc29-attribute-row">
                        <span className="pc29-attribute-label">{ATTRIBUTE_DISPLAY_NAMES[row.label] || row.label}</span>
                        <span className="pc29-attribute-rating">{value || "—"}</span>
                        <div className="pc29-attribute-bar">
                          <div className="pc29-attribute-fill" style={{ width: `${value}%` }} />
                          {hasAverage && <div className="pc29-attribute-average" style={{ left: `${average}%` }} title={`League average ${average.toFixed(1)}`} />}
                        </div>
                        <span className={`pc29-delta ${deltaClass}`}>{deltaLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "contract" && (
              <div className="pc-modal-scroll h-full overflow-y-auto pr-1">
                <div className="pc29-section-head">
                  <div>
                    <h3 className="text-[16px] font-semibold text-zinc-100">Contract</h3>
                    <div className="mt-0.5 text-[10px] text-zinc-500">Current deal, rights, and salary breakdown.</div>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.10em] text-orange-300">{contractTypeLabel}</span>
                </div>

                <div className="pc29-contract-grid">
                  <div className="pc29-contract-panel">
                    <div className="pc29-contract-title">Contract Overview</div>
                    <CompactDataRow label="Contract Type" value={contractTypeLabel} />
                    <CompactDataRow label="Years Remaining" value={isNonCapDevelopmentContract ? developmentYearsLabel : contractYears ? `${contractYears} years` : "No active deal"} />
                    <CompactDataRow label="Average Annual Value" value={isNonCapDevelopmentContract ? "No cap hit" : contractAav > 0 ? formatMillions(contractAav) : "—"} accent />
                    <CompactDataRow label="Total Remaining" value={isNonCapDevelopmentContract ? "No cap" : contractTotalRemaining > 0 ? formatMillions(contractTotalRemaining) : "—"} />
                    <CompactDataRow label="Start Year" value={contractDisplayStartYear || "—"} />
                    <CompactDataRow label="Free Agency" value={contractFreeAgencyYear || "—"} />
                    {optionType && <CompactDataRow label="Option" value={optionType} />}

                    <div className="pc29-rights">
                      <div className="pc29-rights-label">Rights & Bio</div>
                      <div className="pc29-rights-list">
                        <span className="pc29-right-chip">Bird Rights: {formatBirdLevel(rights?.birdLevel)}</span>
                        <span className="pc29-right-chip">Held by: {rights?.heldByTeam || "—"}</span>
                        {rights?.rookieScale && <span className="pc29-right-chip">Rookie Scale</span>}
                        {rights?.restrictedFreeAgent && <span className="pc29-right-chip">RFA</span>}
                        {player?.meta?.acquiredVia && <span className="pc29-right-chip">Via {String(player.meta.acquiredVia).replaceAll("_", " ")}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="pc29-contract-panel">
                    <div className="pc29-contract-title">Salary Table</div>
                    <div className="pc29-salary-head"><span>Year</span><span>Salary</span></div>
                    {salaryByYear.length ? salaryByYear.map((row, index) => {
                      const optionInfo = getContractOptionInfo(player?.contract, row.originalIndex, contractDisplaySeasonYear, optionWindowActive);
                      return (
                        <div key={`${row.seasonYear}-${row.originalIndex}`} className="pc29-salary-row">
                          <span className={optionInfo ? contractOptionTextClass(optionInfo) : ""}>
                            {row.seasonYear || `Year ${index + 1}`}{optionInfo ? ` · ${optionInfo.label}` : ""}
                          </span>
                          <span className="pc29-salary-amount">{formatDollars(row.salary)}</span>
                        </div>
                      );
                    }) : (
                      <div className="py-8 text-center text-[11px] text-zinc-500">{isNonCapDevelopmentContract ? "Development contracts do not carry standard salary-table payroll." : "No active salary years."}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "trends" && (
              <div className="pc-modal-scroll h-full min-h-0 overflow-y-auto pr-1">
                <div className="rounded-[18px] border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-[16px] font-semibold text-zinc-100">Performance Trends</h3>
                      <div className="mt-0.5 text-[11px] text-zinc-500">Real per-game production from the player&apos;s saved season history.</div>
                    </div>
                    <span className="rounded-[10px] border border-white/[0.07] bg-black/20 px-3 py-1.5 text-[10px] font-medium text-zinc-400">Per Game</span>
                  </div>
                  <PerformanceTrendsChart seasons={seasons} />
                </div>

                <div className="mt-3 rounded-[18px] border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-zinc-100">Season by Season</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-zinc-600">{getTrendRows(seasons).length} tracked</span>
                  </div>
                  {getTrendRows(seasons).length ? (
                    <div className="overflow-x-auto rounded-[12px] border border-white/[0.055]">
                      <table className="w-full min-w-[620px] border-collapse text-[11px]">
                        <thead className="bg-white/[0.025] text-zinc-500">
                          <tr>
                            {["Season", "Team", "GP", "PPG", "RPG", "APG", "SPG", "BPG"].map((head) => (
                              <th key={head} className="px-3 py-2 text-left font-medium">{head}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...getTrendRows(seasons)].reverse().map((row, index) => (
                            <tr key={`${row?.seasonYear}-${row?.teamName}-${index}`} className="border-t border-white/[0.05] text-zinc-300">
                              <td className="px-3 py-2 font-semibold text-zinc-100">{formatSeasonLabel(row?.seasonYear)}</td>
                              <td className="px-3 py-2">{teamAbbrev(row?.teamName)}</td>
                              <td className="px-3 py-2">{row?.games ?? "—"}</td>
                              <td className="px-3 py-2 font-semibold text-orange-300">{safeNumber(row?.ppg, 0).toFixed(1)}</td>
                              <td className="px-3 py-2">{safeNumber(row?.rpg, 0).toFixed(1)}</td>
                              <td className="px-3 py-2">{safeNumber(row?.apg, 0).toFixed(1)}</td>
                              <td className="px-3 py-2">{safeNumber(row?.spg, 0).toFixed(1)}</td>
                              <td className="px-3 py-2">{safeNumber(row?.bpg, 0).toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid min-h-[120px] place-items-center rounded-[12px] border border-white/[0.055] bg-black/20 px-6 text-center">
                      <div>
                        <div className="text-sm font-medium text-zinc-300">No season history yet</div>
                        <div className="mt-1 text-xs text-zinc-600">The table will populate once this player has games in a tracked season.</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "career" && (
              <div className="pc-soft-border flex h-full flex-col rounded-[28px] border border-white/15 bg-white/[0.04] p-4 sm:p-5">
                <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
                  <h3 className="text-xl font-black">Season History</h3>
                  <Chip>{seasons.length} rows</Chip>
                </div>
                {seasons.length ? (
                  <div className="pc-modal-scroll min-h-0 flex-1 overflow-auto rounded-2xl border border-white/15">
                    <table className="w-full border-collapse text-xs sm:text-sm">
                      <thead className="sticky top-0 z-30 bg-zinc-900/95 text-zinc-400 backdrop-blur-md shadow-[0_1px_0_rgba(255,255,255,0.12),0_8px_18px_rgba(0,0,0,0.35)]">
                        <tr>{["Season", "Honors", "Team", "GP", "PPG", "RPG", "APG", "SPG", "BPG", "FG%", "3P%", "FT%"].map((head) => <th key={head} className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-[0.12em]">{head}</th>)}</tr>
                      </thead>
                      <tbody>
                        {seasons.map((row, index) => {
                          const isTotal = row?.rowType === "total" || row?.teamName === "Total";
                          const seasonYear = Number(row?.seasonYear || 0);
                          const honors = honorIndex.get(seasonYear) || [];
                          const honorKey = `${seasonYear}-${row?.teamName || "team"}-${index}`;
                          return (
                            <tr key={`${row?.seasonYear}-${row?.teamName}-${index}`} className={isTotal ? "bg-orange-500/10 text-orange-100" : "border-t border-white/5 text-zinc-200"}>
                              <td className="px-3 py-3 font-black">{row?.seasonYear || "-"}</td>
                              <td className="px-3 py-3"><HonorCell honors={honors} honorKey={honorKey} isOpen={openHonorKey === honorKey} onToggle={() => setOpenHonorKey((prev) => (prev === honorKey ? null : honorKey))} /></td>
                              <td className="max-w-[220px] px-3 py-3">
                                <div className="flex items-center gap-2">
                                  {row?.teamLogo ? <img src={row.teamLogo} alt={row.teamName} className="h-6 w-6 shrink-0 object-contain" /> : <div className="h-6 w-6 shrink-0" />}
                                  <span className="truncate font-bold">{row?.teamName || "-"}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3">{row?.games ?? "-"}</td>
                              <td className="px-3 py-3">{row?.ppg ?? "-"}</td>
                              <td className="px-3 py-3">{row?.rpg ?? "-"}</td>
                              <td className="px-3 py-3">{row?.apg ?? "-"}</td>
                              <td className="px-3 py-3">{row?.spg ?? "-"}</td>
                              <td className="px-3 py-3">{row?.bpg ?? "-"}</td>
                              <td className="px-3 py-3">{row?.fgPct ?? "-"}</td>
                              <td className="px-3 py-3">{row?.threePct ?? "-"}</td>
                              <td className="px-3 py-3">{row?.ftPct ?? "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState title="No season history yet" subtitle="Generated rookies or custom players can start building history after simulated seasons." />}
              </div>
            )}

            {activeTab === "accolades" && (
              <div className="pc-soft-border flex h-full flex-col rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black">Accolades</h3>
                    <div className="mt-1 text-sm text-zinc-500">Repeated honors are grouped with year lists instead of duplicated cards.</div>
                  </div>
                  <Chip tone="orange">{groupedAccolades.length} shown / {allGroupedAccolades.length} groups</Chip>
                </div>

                {accolades.length ? (
                  <>
                    <div className="mb-4 flex shrink-0 gap-2 overflow-x-auto pb-1">
                      {ACCOLADE_FILTERS.map((filter) => {
                        const count = filter.key === "all" ? accolades.length : accolades.filter((row) => matchesAccoladeFilter(row, filter.key)).length;
                        return (
                          <button key={filter.key} type="button" onClick={() => setAccoladeFilter(filter.key)} className={`shrink-0 rounded-2xl border px-3 py-2 text-xs font-black transition ${accoladeFilter === filter.key ? "border-orange-400/40 bg-orange-500 text-white shadow-lg shadow-orange-500/15" : "border-white/10 bg-black/25 text-zinc-300 hover:border-orange-400/30 hover:bg-orange-500/10 hover:text-white"}`}>
                            {filter.label}<span className="ml-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-white/80">{count}</span>
                          </button>
                        );
                      })}
                    </div>

                    {groupedAccolades.length ? (
                      <div className="pc-modal-scroll min-h-0 flex-1 overflow-y-auto pr-2">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {groupedAccolades.map((group) => (
                            <div key={group.key} className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-4 transition hover:border-orange-300/35 hover:bg-orange-500/15">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-300">{group.years[0] || "—"}{group.years.length > 1 ? ` · ${group.years.length} seasons` : ""}</div>
                                  <div className="mt-1 text-lg font-black text-white">{group.label}{group.count > 1 ? ` x${group.count}` : ""}</div>
                                </div>
                                <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/25 text-lg">
                                  {group.icon}
                                  {group.count > 1 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-black text-white shadow-lg shadow-black/40">x{group.count}</span>}
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">{group.displayType}</span>
                                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-300">Years: {group.years.join(", ") || "—"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <EmptyState title="No accolades in this filter" subtitle="Try All, Major, League Teams, All-Star, or Champion." />}
                  </>
                ) : <EmptyState title="No accolades yet" subtitle="Awards, All-Star selections, All-NBA, rings, and Finals MVPs will appear here." />}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
