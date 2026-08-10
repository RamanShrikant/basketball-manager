import React, { useEffect, useMemo, useRef, useState } from "react";
import LZString from "lz-string";

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
  { key: "mood", label: "Mood" },
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
  const leagueYears = [leagueData?.currentSeasonYear, leagueData?.seasonYear]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 1900);

  if (leagueYears.length) return Math.max(...leagueYears) + 1;

  const meta = safeJSON(localStorage.getItem("bm_league_meta_v1"), {});
  const metaStartYear = Number(meta?.seasonYear);
  return Number.isFinite(metaStartYear) && metaStartYear > 1900 ? metaStartYear + 1 : 2026;
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
  const clean = dedupeDisplaySeasonRows(rows);
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
    ].filter((row) => Number(row?.seasonYear || 0) !== Number(currentSeasonYear))),
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
    <div className="relative grid h-[112px] w-[112px] shrink-0 place-items-center rounded-full bg-black/10">
      <svg viewBox="0 0 126 126" className="absolute h-[112px] w-[112px] -rotate-90">
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
        <div className="-mt-0.5 text-[40px] font-black leading-none text-orange-300">{value ?? "-"}</div>
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

export default function PlayerCardModal({
  open,
  player,
  team,
  teamName,
  teamLogo,
  leagueData,
  currentStats,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [accoladeFilter, setAccoladeFilter] = useState("all");
  const [openHonorKey, setOpenHonorKey] = useState(null);
  const contentRootRef = useRef(null);

  const resolvedTeamName = useMemo(() => getPrimaryTeamName(player, team?.name || teamName), [player, team?.name, teamName]);
  const resolvedTeamLogo = useMemo(() => getPrimaryTeamLogo(player, team?.logo || teamLogo, leagueData, resolvedTeamName), [player, team?.logo, teamLogo, leagueData, resolvedTeamName]);
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
  const salaryByYear = isNonCapDevelopmentContract ? [] : Array.isArray(player?.contract?.salaryByYear) ? player.contract.salaryByYear : [];
  const contractYears = isNonCapDevelopmentContract ? 0 : getContractYears(player?.contract);
  const contractAav = isNonCapDevelopmentContract ? 0 : getContractAav(player?.contract);
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
  const topAttributes = [...attributeRows].sort((a, b) => b.value - a.value).slice(0, 4);
  const latestSeason = careerSummary.latest;
  const featuredAccolades = allGroupedAccolades.slice(0, 4);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-3 py-3 sm:px-6">
      <style>{`
        .pc-modal-scroll { scrollbar-width: thin; scrollbar-color: #f97316 #111111; }
        .pc-modal-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
        .pc-modal-scroll::-webkit-scrollbar-track { background: #111111; border-radius: 9999px; }
        .pc-modal-scroll::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #fb923c, #c2410c); border-radius: 9999px; border: 2px solid #111111; }
        .pc-glow-card { box-shadow: 0 28px 90px rgba(0,0,0,0.64), 0 0 42px rgba(229,231,235,0.055); }
        .pc-soft-border { box-shadow: 0 0 0 1px rgba(255,255,255,0.035), 0 0 16px rgba(229,231,235,0.055); }
        .pc-stat-pill { box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 0 13px rgba(229,231,235,0.055); }
        .pc-face-card { box-shadow: 0 0 18px rgba(229,231,235,0.07), inset 0 1px 0 rgba(255,255,255,0.035); }
        .pc-shimmer { background: linear-gradient(110deg, rgba(255,255,255,0.05), rgba(251,146,60,0.16), rgba(255,255,255,0.05)); background-size: 260% 100%; animation: pc-shimmer 7s ease-in-out infinite; }
        @keyframes pc-shimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes pc-pop { from { opacity: 0; transform: translateY(18px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .pc-pop { animation: pc-pop 180ms ease-out both; }
      `}</style>

      <button type="button" aria-label="Close player card" onClick={onClose} className="absolute inset-0 bg-black/75 backdrop-blur-md" />

      <div className="pc-pop pc-glow-card relative flex h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-[30px] border border-white/15 bg-[#090909] text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-24 top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-44 w-[70%] -translate-x-1/2 bg-orange-500/5 blur-3xl" />
        </div>

        <div className="relative shrink-0 overflow-hidden border-b-2 border-orange-500/45 bg-zinc-950/95 shadow-[0_8px_28px_rgba(249,115,22,0.08)]">
          <div className="pc-shimmer absolute inset-x-0 top-0 h-[3px]" />
          <div className="px-5 pt-3 pb-2 sm:px-6 sm:pt-4 sm:pb-2 pr-16">
            <div className="flex min-w-0 gap-5">
              <div className="pc-face-card relative -mb-[10px] flex h-36 w-28 shrink-0 self-end items-end justify-center overflow-hidden rounded-t-[26px] rounded-b-none border-x-2 border-t-2 border-b-0 border-white/20 bg-gradient-to-b from-zinc-800 to-zinc-950 sm:h-40 sm:w-32">
                {resolvedTeamLogo && <img src={resolvedTeamLogo} alt={resolvedTeamName} className="absolute inset-0 m-auto h-28 w-28 object-contain opacity-12 blur-[1px]" />}
                {portraitUrl ? (
                  <img src={portraitUrl} alt={player.name} className="relative z-10 h-full w-full object-contain object-bottom drop-shadow-2xl" style={{ transform: "translateY(2px) scale(1.2)", transformOrigin: "bottom center" }} />
                ) : (
                  <div className="relative z-10 flex h-full w-full items-center justify-center text-sm font-bold text-zinc-500">No Image</div>
                )}
              </div>

              <div className="relative top-2 min-w-0 flex-1 self-end pb-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Chip tone={contractTypeTone}>{contractTypeLabel}</Chip>
                  {assignmentLabel && <Chip>{assignmentLabel}</Chip>}
                  {rights?.restrictedFreeAgent && <Chip tone="green">RFA</Chip>}
                </div>

                <h2 className={`max-w-[640px] break-words font-black leading-[0.92] tracking-tight ${String(player?.name || "").length > 24 ? "text-3xl sm:text-[38px]" : String(player?.name || "").length > 17 ? "text-4xl sm:text-[44px]" : "text-4xl sm:text-[46px]"}`}>
                  {player?.name || "Unknown Player"}
                </h2>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <MiniOverallPill value={player?.overall ?? "-"} potential={player?.potential ?? "-"} circumference={2 * Math.PI * 52} offset={(2 * Math.PI * 52) * (1 - fillPercent)} />
                  <HeaderTeamPill teamName={resolvedTeamName} teamLogo={resolvedTeamLogo} />
                  <HeaderInfoPill label="POS" value={`${player?.pos || "-"}${player?.secondaryPos ? ` / ${player.secondaryPos}` : ""}`} />
                  <HeaderInfoPill label="AGE" value={player?.age ?? "-"} />
                  <HeaderInfoPill label="HEIGHT" value={formatHeight(player?.height)} />
                </div>
              </div>
            </div>

            <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-xl font-black text-zinc-300 transition hover:border-orange-400/40 hover:bg-orange-500/15 hover:text-white" aria-label="Close">×</button>
          </div>
        </div>

        <div ref={contentRootRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pt-3 pb-5 sm:px-7 sm:pt-3 sm:pb-6">
          <div className="pc-soft-border mb-4 shrink-0 rounded-[22px] border border-white/15 bg-black/30 p-2.5">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {TABS.map((tab) => {
                const badge = tab.key === "career" ? seasons.length : tab.key === "accolades" ? allGroupedAccolades.length : null;
                return (
                  <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-black transition ${activeTab === tab.key ? "border-orange-400/40 bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "border-white/10 bg-white/[0.05] text-zinc-300 hover:border-orange-400/25 hover:bg-orange-500/10 hover:text-white"}`}>
                    <span>{tab.label}</span>
                    {badge !== null && <span className="ml-2 rounded-full bg-black/25 px-2 py-0.5 text-[11px] text-white/80">{badge}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab === "overview" && (
              <div className="grid h-full min-h-0 gap-3 overflow-hidden lg:grid-cols-[1fr_0.86fr]">
                <div className="min-h-0 space-y-3 overflow-hidden">
                  <div className="pc-soft-border rounded-[22px] border border-white/15 bg-white/[0.04] p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-black">Snapshot</h3>
                      <Chip tone={contractTypeTone}>{resolvedTeamName || "Free Agent"}</Chip>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <StatPill compact label="Career GP" value={careerSummary.games || "-"} />
                      <StatPill compact label="Career PPG" value={careerSummary.ppg || "-"} accent />
                      <StatPill compact label="Career APG" value={careerSummary.apg || "-"} />
                      <StatPill compact label="Latest PPG" value={latestSeason?.ppg ?? "-"} accent />
                      <StatPill compact label="Latest RPG" value={latestSeason?.rpg ?? "-"} />
                      <StatPill compact label="Latest APG" value={latestSeason?.apg ?? "-"} />
                    </div>
                  </div>

                  <div className="pc-soft-border rounded-[22px] border border-white/15 bg-white/[0.04] p-3">
                    <h3 className="mb-2 text-lg font-black">Top Attributes</h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      {topAttributes.map((row) => <AttributeCompareRow compact key={row.label} {...row} />)}
                    </div>
                  </div>
                </div>

                <div className="min-h-0 space-y-3 overflow-hidden">
                  <div className="pc-soft-border rounded-[22px] border border-white/15 bg-white/[0.04] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-black">Contract</h3>
                      <Chip tone={contractTypeTone}>{contractYears ? `${contractYears} yrs` : contractTypeLabel}</Chip>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <StatPill compact label="AAV" value={isNonCapDevelopmentContract ? "No cap" : formatMillions(contractAav)} accent />
                      <StatPill compact label="Start" value={player?.contract?.startYear || "-"} />
                    </div>
                  </div>

                  <div className="pc-soft-border rounded-[22px] border border-white/15 bg-white/[0.04] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-black">Trophy Case</h3>
                      <Chip tone="orange">{accolades.length} honors</Chip>
                    </div>
                    {featuredAccolades.length ? (
                      <div className="grid grid-cols-2 gap-2.5">
                        {featuredAccolades.map((group) => (
                          <div key={group.key} className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-black text-white">{group.label}</div>
                              <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/25 text-base">
                                {group.icon}
                                {group.count > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-black text-white">x{group.count}</span>}
                              </div>
                            </div>
                            <div className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-300">{group.years.join(", ") || "—"}</div>
                          </div>
                        ))}
                      </div>
                    ) : <EmptyState title="No accolades yet" />}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "attributes" && (
              <div className="pc-soft-border flex h-full flex-col rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black">Attributes vs League Average</h3>
                    <div className="mt-1 text-sm text-zinc-500">White tick marks show the current league average for each rating.</div>
                  </div>
                  <Chip tone="orange">{ATTR_LABELS.length} ratings</Chip>
                </div>
                <div className="pc-modal-scroll min-h-0 flex-1 overflow-y-auto pr-2">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {attributeRows.map((row) => <AttributeCompareRow key={row.label} {...row} />)}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "contract" && (
              <div className="grid h-full gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-xl font-black">Contract</h3>
                    <Chip tone={contractTypeTone}>{contractTypeLabel}</Chip>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <StatPill label="Type" value={contractTypeLabel} accent />
                    <StatPill label="Years" value={isNonCapDevelopmentContract ? developmentYearsLabel : contractYears ? `${contractYears}` : "No deal"} />
                    <StatPill label="AAV" value={isNonCapDevelopmentContract ? "No cap hit" : formatMillions(contractAav)} accent />
                    <StatPill label="Start" value={player?.contract?.startYear || "-"} />
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Rights & Bio</div>
                    <div className="flex flex-wrap gap-2">
                      <Chip tone="orange">{formatBirdLevel(rights?.birdLevel)}</Chip>
                      {rights?.heldByTeam && <Chip>Held by {rights.heldByTeam}</Chip>}
                      {rights?.rookieScale && <Chip tone="green">Rookie Scale</Chip>}
                      {rights?.restrictedFreeAgent && <Chip tone="green">Restricted FA</Chip>}
                      {player?.meta?.acquiredVia && <Chip>Via {String(player.meta.acquiredVia).replaceAll("_", " ")}</Chip>}
                    </div>
                  </div>
                </div>

                <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                  <h3 className="mb-4 text-xl font-black">Salary Table</h3>
                  {salaryByYear.length ? (
                    <div className="grid gap-3">
                      {salaryByYear.map((salary, index) => {
                        const seasonYear = safeNumber(player?.contract?.startYear, 0) + index;
                        const optionInfo = getContractOptionInfo(player?.contract, index, contractDisplaySeasonYear, optionWindowActive);
                        return (
                          <div key={`${seasonYear}-${index}`} className={`pc-stat-pill flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${contractOptionRowClass(optionInfo)}`}>
                            <span className={`font-bold ${contractOptionTextClass(optionInfo)}`}>
                              {seasonYear || `Year ${index + 1}`}
                              {optionInfo ? ` (${optionInfo.label.toLowerCase()}${optionInfo.pending ? ", pending" : ""})` : ""}
                            </span>
                            <span className="font-black text-white">{formatDollars(salary)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState title={isNonCapDevelopmentContract ? "No salary-cap contract" : "No active contract"} subtitle={isNonCapDevelopmentContract ? "Development and stash contracts do not carry standard salary-table payroll." : "This player is currently showing without salary years."} />
                  )}
                </div>
              </div>
            )}

            {activeTab === "mood" && (
              <div className="grid h-full min-h-0 items-stretch gap-3 overflow-hidden lg:grid-cols-[0.62fr_1.38fr]">
                <div className={`rounded-[32px] border bg-gradient-to-br ${moodTheme} p-[1px]`}>
                  <div className="flex h-full flex-col justify-center rounded-[31px] bg-zinc-950/90 p-4">
                    <div className="text-sm font-black uppercase tracking-[0.24em] text-zinc-500">Mood</div>
                    <div className="mt-2 text-4xl font-black text-white">{mood.label}</div>
                    <div className="mt-2 text-sm text-zinc-400">{mood.source === "saved" ? "Saved from player profile" : "Generated from team context, role, contract, and history"}</div>
                    <div className="mt-4 grid place-items-center">
                      <div className="relative grid h-32 w-32 place-items-center rounded-full bg-white/[0.04]">
                        <svg viewBox="0 0 150 150" className="h-full w-full -rotate-90">
                          <circle cx="75" cy="75" r="62" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
                          <circle cx="75" cy="75" r="62" fill="none" stroke="#fb923c" strokeWidth="14" strokeLinecap="round" strokeDasharray={2 * Math.PI * 62} strokeDashoffset={(2 * Math.PI * 62) * (1 - mood.value / 100)} />
                        </svg>
                        <div className="absolute text-center">
                          <div className="text-3xl font-black text-orange-300">{mood.value}</div>
                          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">out of 100</div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-center"><Chip tone={mood.trend === "down" ? "red" : mood.trend === "up" ? "green" : "orange"}>Trend: {mood.trend}</Chip></div>
                  </div>
                </div>

                <div className="pc-soft-border rounded-[32px] border border-white/15 bg-white/[0.04] p-4">
                  <h3 className="text-xl font-black">Why he feels this way</h3>
                  <div className="mt-3 grid gap-2.5">
                    {mood.reasons.map((reason, index) => (
                      <div key={`${reason}-${index}`} className="flex gap-3 rounded-2xl border border-white/10 bg-black/20 p-2.5">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500/15 text-sm font-black text-orange-300">{index + 1}</div>
                        <div className="text-sm font-semibold leading-relaxed text-zinc-200">{reason}</div>
                      </div>
                    ))}
                  </div>

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
    </div>
  );
}
