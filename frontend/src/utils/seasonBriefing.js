// New Chapter / Season Briefing
// ---------------------------------
// 2026-27 uses the exact handcrafted opening-universe copy.
// 2027-28 onward is rebuilt from factual save-state events: results, archived
// stats, transactions, progression, awards, retirements, draft capital and the
// live upcoming class. Generated snapshots are frozen once per team/season so
// the story cannot rewrite itself halfway through a year.

import { getSeasonStartYear } from "./seasonContext.js";
import {
  getUpcomingDraftYearForPhase,
  readUpcomingDraftClassForYear,
} from "./upcomingDraftClass.js";
import { getFirstSeasonBriefing2026 } from "../data/seasonBriefingFirstSeason2026.js";

export const SEASON_BRIEFING_FILENAMES = Object.freeze({
  "Atlanta Hawks": "atlanta-hawks.png",
  "Boston Celtics": "boston-celtics.png",
  "Brooklyn Nets": "brooklyn-nets.png",
  "Charlotte Hornets": "charlotte-hornets.png",
  "Chicago Bulls": "chicago-bulls.png",
  "Cleveland Cavaliers": "cleveland-cavaliers.png",
  "Dallas Mavericks": "dallas-mavericks.png",
  "Denver Nuggets": "denver-nuggets.png",
  "Detroit Pistons": "detroit-pistons.png",
  "Golden State Warriors": "golden-state-warriors.png",
  "Houston Rockets": "houston-rockets.png",
  "Indiana Pacers": "indiana-pacers.png",
  "Los Angeles Clippers": "los-angeles-clippers.png",
  "Los Angeles Lakers": "los-angeles-lakers.png",
  "Memphis Grizzlies": "memphis-grizzlies.png",
  "Miami Heat": "miami-heat.png",
  "Milwaukee Bucks": "milwaukee-bucks.png",
  "Minnesota Timberwolves": "minnesota-timberwolves.png",
  "New Orleans Pelicans": "new-orleans-pelicans.png",
  "New York Knicks": "new-york-knicks.png",
  "Oklahoma City Thunder": "oklahoma-city-thunder.png",
  "Orlando Magic": "orlando-magic.png",
  "Philadelphia 76ers": "philadelphia-76ers.png",
  "Phoenix Suns": "phoenix-suns.png",
  "Portland Trail Blazers": "portland-trail-blazers.png",
  "Sacramento Kings": "sacramento-kings.png",
  "San Antonio Spurs": "san-antonio-spurs.png",
  "Toronto Raptors": "toronto-raptors.png",
  "Utah Jazz": "utah-jazz.png",
  "Washington Wizards": "washington-wizards.png",
});

const TEAM_ALIASES = Object.freeze({
  "la clippers": "Los Angeles Clippers",
  "la lakers": "Los Angeles Lakers",
  "okc thunder": "Oklahoma City Thunder",
  "oklahoma thunder": "Oklahoma City Thunder",
  "portland blazers": "Portland Trail Blazers",
  "sixers": "Philadelphia 76ers",
  "philadelphia sixers": "Philadelphia 76ers",
});

export const SEASON_BRIEFING_CONTENT_VERSION = 5;
export const MAX_SEASON_BRIEFING_SNAPSHOTS = 8;
export const MAX_SEASON_BRIEFING_STORYLINES = 12;

const wallpaperProbeCache = new Map();

function text(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return text(value).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeJson(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getAllTeams(leagueData) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.filter(Boolean);
  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    return Object.entries(leagueData.conferences).flatMap(([conference, teams]) =>
      (teams || []).filter(Boolean).map((team) => ({
        ...team,
        conference: team?.conference || team?.conf || conference,
      }))
    );
  }
  return [];
}

function teamNameOf(team) {
  return text(team?.name || team?.teamName || team?.team);
}

function playerNameOf(player) {
  return text(player?.name || player?.player || player?.playerName || player?.fullName) || "Unknown Player";
}

function playerOverall(player) {
  return safeNumber(player?.overall ?? player?.ovr ?? player?.rating, 0);
}

function playerPotential(player) {
  return safeNumber(player?.potential ?? player?.pot ?? player?.potential_rating, playerOverall(player));
}

function playerAge(player) {
  return safeNumber(player?.age ?? player?.playerAge, 0);
}

function playerPosition(player) {
  return text(player?.pos || player?.position || player?.primaryPosition).toUpperCase();
}

function getRoster(team) {
  return [team?.players, team?.twoWayPlayers, team?.stashPlayers]
    .flatMap((rows) => Array.isArray(rows) ? rows : [])
    .filter(Boolean);
}

function canonicalTeamName(teamName) {
  const raw = text(teamName);
  if (SEASON_BRIEFING_FILENAMES[raw]) return raw;
  const normalized = normalizeName(raw);
  const alias = TEAM_ALIASES[normalized];
  if (alias) return alias;
  return Object.keys(SEASON_BRIEFING_FILENAMES).find((name) => normalizeName(name) === normalized) || "";
}

function findTeam(leagueData, teamName) {
  const target = normalizeName(canonicalTeamName(teamName) || teamName);
  return getAllTeams(leagueData).find((team) => normalizeName(teamNameOf(team)) === target) || null;
}

function uniqueNames(values, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const name = text(value);
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

function naturalList(values, conjunction = "and") {
  const rows = uniqueNames(values, 12);
  if (!rows.length) return "";
  if (rows.length === 1) return rows[0];
  if (rows.length === 2) return `${rows[0]} ${conjunction} ${rows[1]}`;
  return `${rows.slice(0, -1).join(", ")}, ${conjunction} ${rows.at(-1)}`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of text(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function choose(seed, variants) {
  return variants?.length ? variants[stableHash(seed) % variants.length] : "";
}

function seasonLabel(startYear) {
  const year = safeNumber(startYear, 0);
  return year ? `${year}-${String(year + 1).slice(-2)}` : "New Season";
}

function formatRecord(row) {
  const wins = safeNumber(row?.wins ?? row?.w, -1);
  const losses = safeNumber(row?.losses ?? row?.l, -1);
  return wins >= 0 && losses >= 0 ? `${wins}-${losses}` : "";
}

function formatFinish(row) {
  if (!row) return "";
  if (row.champion) return "won the NBA championship";
  if (row.finals) return "reached the NBA Finals";
  if (row.conferenceFinals) return "reached the conference finals";
  const raw = text(row.playoffResult).replaceAll("_", " ");
  if (raw === "second round") return "lost in the second round";
  if (raw === "first round") return "lost in the first round";
  if (raw === "play in") return "ended in the Play-In";
  if (row.madePlayoffs) return "made the playoffs";
  if (row.madePlayIn) return "reached the Play-In";
  return "missed the postseason";
}

export function getSeasonBriefingTeamSlug(teamName) {
  const canonical = canonicalTeamName(teamName);
  return (SEASON_BRIEFING_FILENAMES[canonical] || "").replace(/\.png$/i, "");
}

export function getSeasonBriefingWallpaperUrl(teamName) {
  const filename = SEASON_BRIEFING_FILENAMES[canonicalTeamName(teamName)];
  return filename ? `/season-briefings/${filename}` : "";
}

export function getSeasonBriefingSeasonYear(leagueData, explicitYear = null) {
  const explicit = safeNumber(explicitYear, 0);
  if (explicit >= 2020 && explicit <= 2100) return Math.trunc(explicit);
  const inferred = safeNumber(getSeasonStartYear(leagueData || {}), 0);
  return inferred >= 2020 && inferred <= 2100 ? Math.trunc(inferred) : 0;
}

export function getSeasonBriefingKey(leagueData, teamName, explicitYear = null) {
  const seasonYear = getSeasonBriefingSeasonYear(leagueData, explicitYear);
  const slug = getSeasonBriefingTeamSlug(teamName);
  return seasonYear && slug ? `${seasonYear}:${slug}` : "";
}

export function getSeasonBriefingLeagueScope(leagueData = {}) {
  return text(
    leagueData?.__leagueStorageId ||
    leagueData?.leagueId ||
    leagueData?.saveId ||
    leagueData?.meta?.leagueId ||
    leagueData?.metadata?.leagueId ||
    "legacy_active_league"
  );
}

function validStoredBriefing(briefing, key, leagueData, teamName, explicitYear) {
  if (!briefing || typeof briefing !== "object") return false;
  const seasonYear = getSeasonBriefingSeasonYear(leagueData, explicitYear);
  const slug = getSeasonBriefingTeamSlug(teamName);
  return Boolean(
    key && seasonYear && slug &&
    Number(briefing.seasonYear) === seasonYear &&
    text(briefing.teamSlug) === slug &&
    briefing?.tabs?.team && briefing?.tabs?.league && briefing?.tabs?.prospects && briefing?.tabs?.outlook
  );
}

export function getStoredSeasonBriefingSnapshot(leagueData, teamName, explicitYear = null) {
  const key = getSeasonBriefingKey(leagueData, teamName, explicitYear);
  const record = leagueData?.seasonBriefingState?.snapshots?.[key];
  const scope = getSeasonBriefingLeagueScope(leagueData);
  if (!record || Number(record?.contentVersion || 0) !== SEASON_BRIEFING_CONTENT_VERSION) return null;
  if (text(record?.leagueScope) !== scope || text(record?.briefing?.leagueScope) !== scope) return null;
  return validStoredBriefing(record.briefing, key, leagueData, teamName, explicitYear) ? record.briefing : null;
}

function previousStoredSnapshot(leagueData, teamName, seasonYear) {
  const targetSlug = getSeasonBriefingTeamSlug(teamName);
  const rows = Object.values(leagueData?.seasonBriefingState?.snapshots || {})
    .map((record) => record?.briefing)
    .filter((briefing) =>
      briefing && briefing.teamSlug === targetSlug && Number(briefing.seasonYear) < Number(seasonYear)
    )
    .sort((a, b) => Number(b.seasonYear) - Number(a.seasonYear));
  return rows[0] || null;
}

export function storeSeasonBriefingSnapshot(leagueData, teamName, briefing, explicitYear = null) {
  if (!leagueData) return leagueData;
  const key = getSeasonBriefingKey(leagueData, teamName, explicitYear);
  if (!validStoredBriefing(briefing, key, leagueData, teamName, explicitYear)) return leagueData;

  const previousState = leagueData?.seasonBriefingState || {};
  const createdAt = new Date().toISOString();
  const nextRecord = {
    contentVersion: SEASON_BRIEFING_CONTENT_VERSION,
    createdAt,
    teamName: canonicalTeamName(teamName) || text(teamName),
    seasonYear: getSeasonBriefingSeasonYear(leagueData, explicitYear),
    leagueScope: getSeasonBriefingLeagueScope(leagueData),
    briefing,
  };

  const snapshots = Object.fromEntries(
    Object.entries({ ...(previousState.snapshots || {}), [key]: nextRecord })
      .sort((a, b) => text(b?.[1]?.createdAt).localeCompare(text(a?.[1]?.createdAt)))
      .slice(0, MAX_SEASON_BRIEFING_SNAPSHOTS)
  );

  const nextStoryline = briefing?.dossier?.primaryStoryline || null;
  const storylines = nextStoryline
    ? [
        nextStoryline,
        ...(Array.isArray(previousState.storylines) ? previousState.storylines : []).filter(
          (row) => !(row?.teamSlug === briefing.teamSlug && Number(row?.seasonYear) === Number(briefing.seasonYear))
        ),
      ].slice(0, MAX_SEASON_BRIEFING_STORYLINES)
    : (previousState.storylines || []).slice(0, MAX_SEASON_BRIEFING_STORYLINES);

  return {
    ...leagueData,
    seasonBriefingState: {
      ...previousState,
      version: 3,
      viewed: previousState.viewed || {},
      snapshots,
      storylines,
    },
  };
}

export function hasViewedSeasonBriefing(leagueData, keyOrTeamName, explicitYear = null) {
  const key = keyOrTeamName?.includes?.(":")
    ? keyOrTeamName
    : getSeasonBriefingKey(leagueData, keyOrTeamName, explicitYear);
  return Boolean(key && leagueData?.seasonBriefingState?.viewed?.[key]);
}

export function markSeasonBriefingViewed(leagueData, teamName, explicitYear = null) {
  if (!leagueData) return leagueData;
  const key = getSeasonBriefingKey(leagueData, teamName, explicitYear);
  if (!key) return leagueData;
  const previousState = leagueData.seasonBriefingState || {};
  if (previousState?.viewed?.[key]) return leagueData;
  return {
    ...leagueData,
    seasonBriefingState: {
      ...previousState,
      version: 3,
      snapshots: previousState.snapshots || {},
      storylines: previousState.storylines || [],
      viewed: {
        ...(previousState.viewed || {}),
        [key]: {
          viewedAt: new Date().toISOString(),
          teamName: canonicalTeamName(teamName) || text(teamName),
          seasonYear: getSeasonBriefingSeasonYear(leagueData, explicitYear),
        },
      },
    },
  };
}

export function preloadSeasonBriefingWallpaper(url) {
  if (!url || typeof Image === "undefined") return Promise.resolve(false);
  if (wallpaperProbeCache.has(url)) return wallpaperProbeCache.get(url);
  const probe = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
  wallpaperProbeCache.set(url, probe);
  return probe;
}

function scheduledGameIncludesTeam(game, teamName) {
  const target = normalizeName(canonicalTeamName(teamName) || teamName);
  return Boolean(target && game && [game.home, game.away, game.homeName, game.awayName]
    .some((value) => normalizeName(canonicalTeamName(value) || value) === target));
}

export function countScheduledTeamGames(scheduleByDate, teamName) {
  return Object.values(scheduleByDate || {}).reduce((count, games) => count + (games || []).filter(
    (game) => game?.id && scheduledGameIncludesTeam(game, teamName)
  ).length, 0);
}

export function countCompletedTeamGames(scheduleByDate, teamName) {
  return Object.values(scheduleByDate || {}).reduce((count, games) => count + (games || []).filter(
    (game) => game?.id && game?.played && scheduledGameIncludesTeam(game, teamName)
  ).length, 0);
}

export function isSeasonBriefingOpeningWindow({ scheduleByDate, teamName, maxCompletedTeamGames = 2 } = {}) {
  if (!teamName || countScheduledTeamGames(scheduleByDate, teamName) <= 0) return false;
  return countCompletedTeamGames(scheduleByDate, teamName) <= maxCompletedTeamGames;
}

function getPreviousSeasonEntry(leagueData, seasonYear) {
  return [...(Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [])]
    .filter((row) => safeNumber(row?.seasonYear, 0) < seasonYear)
    .sort((a, b) => safeNumber(b?.seasonYear, 0) - safeNumber(a?.seasonYear, 0))[0] || null;
}

function previousTeamRow(entry, teamName) {
  const target = normalizeName(teamName);
  return (Array.isArray(entry?.teams) ? entry.teams : []).find(
    (row) => normalizeName(row?.teamName || row?.team || row?.name) === target
  ) || null;
}

function rosterSnapshot(team) {
  const roster = getRoster(team)
    .map((player) => ({
      name: playerNameOf(player),
      ovr: playerOverall(player),
      pot: playerPotential(player),
      age: playerAge(player),
      pos: playerPosition(player),
      source: player,
    }))
    .filter((row) => row.name && row.ovr)
    .sort((a, b) => b.ovr - a.ovr || b.pot - a.pot || a.age - b.age);
  const rotation = roster.slice(0, 9);
  const top = roster.slice(0, 4);
  const average = rotation.length ? rotation.reduce((sum, row) => sum + row.ovr, 0) / rotation.length : 0;
  const ages = rotation.filter((row) => row.age > 0);
  const averageAge = ages.length ? ages.reduce((sum, row) => sum + row.age, 0) / ages.length : 0;
  const starCount = roster.filter((row) => row.ovr >= 86).length;
  const youngCore = roster.filter((row) => row.age > 0 && row.age <= 25 && row.ovr >= 76);
  const direction = average >= 80.8 && (top[0]?.ovr || 0) >= 87
    ? "contending"
    : averageAge > 0 && averageAge <= 26.2 && youngCore.length >= 2
      ? "developing"
      : average < 76.5 && (top[0]?.ovr || 0) < 85
        ? "rebuilding"
        : "retooling";
  return { roster, rotation, top, average, averageAge, starCount, youngCore, direction };
}

function playerIndex(leagueData) {
  const index = new Map();
  for (const team of getAllTeams(leagueData)) {
    for (const player of getRoster(team)) {
      const name = playerNameOf(player);
      const key = normalizeName(name);
      if (!key) continue;
      index.set(key, { ...player, name, teamName: teamNameOf(team), overall: playerOverall(player) });
    }
  }
  for (const player of leagueData?.freeAgents || []) {
    const name = playerNameOf(player);
    const key = normalizeName(name);
    if (key && !index.has(key)) index.set(key, { ...player, name, teamName: "Free Agency", overall: playerOverall(player) });
  }
  return index;
}

function archivedPlayerRows(previousEntry) {
  return Array.isArray(previousEntry?.statsArchive?.regular?.playerRows)
    ? previousEntry.statsArchive.regular.playerRows
    : [];
}

function previousTeamPlayerStats(previousEntry, teamName) {
  const target = normalizeName(teamName);
  return archivedPlayerRows(previousEntry)
    .filter((row) => normalizeName(row?.teamName || row?.team) === target)
    .map((row) => ({
      name: playerNameOf(row),
      teamName: text(row?.teamName || row?.team),
      overall: playerOverall(row),
      age: playerAge(row),
      stats: row?.stats || {},
    }))
    .filter((row) => row.name)
    .sort((a, b) => safeNumber(b?.stats?.PTS ?? b?.stats?.ppg, 0) - safeNumber(a?.stats?.PTS ?? a?.stats?.ppg, 0));
}

function rosterTurnover(leagueData, snapshot, previousStats, teamName, seasonYear) {
  const currentNames = new Set(snapshot.roster.map((row) => normalizeName(row.name)));
  const previousNames = new Set(previousStats.map((row) => normalizeName(row.name)));
  const index = playerIndex(leagueData);

  const departures = previousStats
    .filter((row) => row?.name && !currentNames.has(normalizeName(row.name)))
    .map((row) => {
      const current = index.get(normalizeName(row.name));
      return {
        name: row.name,
        previousOverall: safeNumber(row.overall, 0),
        previousStatLine: formatStatLine(row),
        destination: current?.teamName && normalizeName(current.teamName) !== normalizeName(teamName)
          ? current.teamName
          : "",
      };
    })
    .sort((a, b) => b.previousOverall - a.previousOverall || a.name.localeCompare(b.name));

  const arrivals = snapshot.roster
    .filter((row) => row?.name && !previousNames.has(normalizeName(row.name)))
    .map((row) => ({
      name: row.name,
      overall: row.ovr,
      potential: row.pot,
      age: row.age,
      rookie: safeNumber(row?.source?.draftYear ?? row?.source?.draftClassYear, 0) === Number(seasonYear),
    }))
    .sort((a, b) => b.overall - a.overall || b.potential - a.potential);

  return { departures, arrivals };
}

function formatStatLine(row) {
  const stats = row?.stats || {};
  const ppg = safeNumber(stats?.PTS ?? stats?.ppg, NaN);
  const rpg = safeNumber(stats?.REB ?? stats?.rpg, NaN);
  const apg = safeNumber(stats?.AST ?? stats?.apg, NaN);
  if (![ppg, rpg, apg].some(Number.isFinite)) return "";
  const values = [ppg, rpg, apg].map((value) => Number.isFinite(value) ? value.toFixed(1) : "0.0");
  return `${values[0]} PPG, ${values[1]} RPG and ${values[2]} APG`;
}

function readProgressionRows(leagueData, seasonYear) {
  if (typeof localStorage === "undefined") return [];
  const meta = safeJson(localStorage.getItem("bm_progression_meta_v1"), {}) || {};
  if (meta?.stage !== "DONE" || meta?.deltasSaved !== true || Number(meta?.appliedForSeasonYear) !== Number(seasonYear)) return [];
  const deltas = safeJson(localStorage.getItem("bm_progression_deltas_v1"), {}) || {};
  const index = playerIndex(leagueData);
  const rows = [];
  for (const [key, delta] of Object.entries(deltas)) {
    const split = String(key).split("__");
    const rawName = split[0] || "";
    const rawTeam = split.slice(1).join("__") || "";
    const player = index.get(normalizeName(rawName));
    const overallDelta = safeNumber(delta?.overall, 0);
    if (!overallDelta || !rawName) continue;
    const currentOverall = safeNumber(player?.overall, 0);
    rows.push({
      name: player?.name || rawName,
      teamName: player?.teamName || rawTeam,
      delta: overallDelta,
      currentOverall,
      originalOverall: currentOverall ? currentOverall - overallDelta : 0,
    });
  }
  return rows;
}

function progressionLeaders(rows, limit = 10) {
  return {
    improved: rows.filter((row) => row.delta > 0).sort((a, b) => b.delta - a.delta || b.currentOverall - a.currentOverall).slice(0, limit),
    regressed: rows.filter((row) => row.delta < 0).sort((a, b) => a.delta - b.delta || b.currentOverall - a.currentOverall).slice(0, limit),
  };
}

function teamProgression(rows, teamName) {
  const target = normalizeName(teamName);
  return rows.filter((row) => normalizeName(row.teamName) === target)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.currentOverall - a.currentOverall)
    .slice(0, 5);
}

function getTradeMoves(row) {
  if (Array.isArray(row?.movedPlayers) && row.movedPlayers.length) {
    return row.movedPlayers.map((move) => ({
      name: text(move?.name || move?.playerName),
      fromTeam: text(move?.fromTeam || move?.from),
      toTeam: text(move?.toTeam || move?.to),
    })).filter((move) => move.name && move.fromTeam && move.toTeam);
  }
  const moves = [];
  for (const name of row?.userSent?.players || []) moves.push({ name:text(name), fromTeam:text(row?.userTeamName), toTeam:text(row?.cpuTeamName) });
  for (const name of row?.cpuSent?.players || []) moves.push({ name:text(name), fromTeam:text(row?.cpuTeamName), toTeam:text(row?.userTeamName) });
  return moves.filter((move) => move.name && move.fromTeam && move.toTeam);
}

function recentTradeEvents(leagueData, seasonYear) {
  const index = playerIndex(leagueData);
  const rows = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  const events = [];
  rows.slice(-80).forEach((row, rowIndex) => {
    const rowYear = safeNumber(row?.seasonYear, 0);
    if (rowYear && rowYear < seasonYear - 1) return;
    for (const move of getTradeMoves(row)) {
      const player = index.get(normalizeName(move.name));
      const ovr = safeNumber(player?.overall, safeNumber(row?.overall, 0));
      events.push({
        type: "trade",
        score: ovr >= 90 ? 96 : ovr >= 86 ? 88 : ovr >= 82 ? 78 : 58,
        playerName: move.name,
        fromTeam: move.fromTeam,
        toTeam: move.toTeam,
        overall: ovr,
        date: text(row?.date || row?.completedAt || row?.timestamp),
        rowIndex,
        headline: `${move.toTeam} acquired ${move.name} from ${move.fromTeam}`,
      });
    }
  });
  return events;
}

function freeAgencyEvents(leagueData, seasonYear) {
  const state = leagueData?.freeAgencyState || {};
  const rows = [
    ...(Array.isArray(state?.signedPlayersLog) ? state.signedPlayersLog : []),
    ...(Array.isArray(state?.latestResults?.signings) ? state.latestResults.signings : []),
    ...(Array.isArray(state?.userOfferOutcomeLog) ? state.userOfferOutcomeLog : []),
  ];
  const index = playerIndex(leagueData);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const name = text(row?.playerName || row?.name || row?.player);
    const teamName = text(row?.teamName || row?.signedWith || row?.winnerTeam);
    const key = `${normalizeName(name)}|${normalizeName(teamName)}`;
    if (!name || !teamName || seen.has(key)) continue;
    seen.add(key);
    const player = index.get(normalizeName(name));
    const ovr = safeNumber(player?.overall, safeNumber(row?.overall, 0));
    out.push({
      type: "free_agency",
      score: ovr >= 90 ? 94 : ovr >= 86 ? 86 : ovr >= 82 ? 76 : 55,
      playerName: name,
      toTeam: teamName,
      overall: ovr,
      headline: `${teamName} signed ${name}`,
    });
  }
  return out;
}

function retirementEvents(leagueData, seasonYear) {
  const rows = [];
  if (typeof localStorage !== "undefined") {
    const result = safeJson(localStorage.getItem("bm_retirement_results_v1"), null);
    if (result && (!result?.seasonYear || Number(result.seasonYear) === Number(seasonYear))) {
      rows.push(...(Array.isArray(result?.retiredPlayers) ? result.retiredPlayers : []));
    }
  }
  rows.push(...(Array.isArray(leagueData?.retiredPlayersHistory) ? leagueData.retiredPlayersHistory : []).filter(
    (row) => !row?.retiredSeasonYear || Number(row.retiredSeasonYear) === Number(seasonYear)
  ));
  const seen = new Set();
  return rows.map((row) => {
    const name = playerNameOf(row);
    const key = normalizeName(name);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const ovr = playerOverall(row);
    return {
      type: "retirement",
      score: ovr >= 90 ? 93 : ovr >= 86 ? 84 : ovr >= 82 ? 75 : 50,
      playerName: name,
      teamName: text(row?.retiredFromTeam || row?.teamName || row?.team),
      overall: ovr,
      headline: `${name} retired${row?.retiredFromTeam ? ` after finishing with ${row.retiredFromTeam}` : ""}`,
    };
  }).filter(Boolean);
}

function leagueHistoryEvents(leagueData, seasonYear, previousEntry) {
  const events = [];
  const champion = text(previousEntry?.champion);
  const championRow = (leagueData?.leagueHistory?.champions || []).find((row) => Number(row?.seasonYear) === Number(seasonYear));
  if (champion || championRow?.championTeam) {
    const team = champion || championRow.championTeam;
    const runner = text(championRow?.runnerUp);
    events.push({ type:"champion", score:110, teamName:team, headline:`${team} won the NBA championship${runner ? ` over ${runner}` : ""}` });
  }
  const awardMap = leagueData?.leagueHistory?.awards || {};
  const awardLabels = {
    mvp:"MVP",
    dpoy:"Defensive Player of the Year",
    roty:"Rookie of the Year",
    roy:"Rookie of the Year",
    mip:"Most Improved Player",
    clutch_player:"Clutch Player of the Year",
    cpoy:"Clutch Player of the Year",
    sixthMan:"Sixth Man of the Year",
    sixth_man:"Sixth Man of the Year",
  };
  for (const [key, rows] of Object.entries(awardMap)) {
    const row = (Array.isArray(rows) ? rows : []).find((item) => Number(item?.seasonYear) === Number(seasonYear) && item?.source !== "real_nba_seed");
    if (!row) continue;
    const label = awardLabels[key] || text(row?.label || key).replaceAll("_", " ");
    const name = playerNameOf(row);
    events.push({ type:"award", score:key === "mvp" ? 102 : 76, playerName:name, teamName:text(row?.team), headline:`${name} won ${label}${row?.team ? ` with ${row.team}` : ""}` });
  }
  return events;
}

function standoutTeamEvents(previousEntry) {
  const rows = Array.isArray(previousEntry?.teams) ? previousEntry.teams : [];
  const out = [];
  for (const row of rows) {
    const wins = safeNumber(row?.wins, 0);
    if (wins >= 60) out.push({ type:"team_season", score:86 + Math.min(8, wins - 60), teamName:text(row?.teamName || row?.team), headline:`${text(row?.teamName || row?.team)} won ${wins} games` });
    else if (wins <= 22 && wins + safeNumber(row?.losses, 0) >= 70) out.push({ type:"team_season", score:60, teamName:text(row?.teamName || row?.team), headline:`${text(row?.teamName || row?.team)} finished only ${wins}-${safeNumber(row?.losses, 0)}` });
  }
  return out;
}

function currentDraftPreview(leagueData, seasonYear) {
  const draftYear = Math.max(seasonYear + 1, getUpcomingDraftYearForPhase(leagueData || {}, { isOffseasonMode:false }));
  const preview = readUpcomingDraftClassForYear(draftYear);
  const rows = Array.isArray(preview?.draftClass) ? preview.draftClass : [];
  return {
    draftYear,
    classCount: rows.length,
    rows: rows.slice().sort((a, b) => safeNumber(a?.draftProjection ?? a?.rank, 999) - safeNumber(b?.draftProjection ?? b?.rank, 999)).slice(0, 10).map((row, index) => ({
      name: playerNameOf(row),
      position: playerPosition(row) || "—",
      projection: safeNumber(row?.draftProjection ?? row?.rank, index + 1),
      overall: playerOverall(row),
      potential: playerPotential(row),
    })),
  };
}

function ownedFirstRoundPicks(leagueData, teamName, draftYear) {
  const target = normalizeName(teamName);
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : []).filter((pick) => {
    const owner = normalizeName(pick?.owner || pick?.currentOwner || pick?.owningTeam || pick?.teamName || pick?.team);
    const year = safeNumber(pick?.year ?? pick?.draftYear ?? pick?.season, 0);
    const round = safeNumber(pick?.round, 0);
    const active = !pick?.status || normalizeName(pick.status) === "active";
    return owner === target && year === draftYear && round === 1 && active;
  });
}

function totalFutureFirsts(leagueData, teamName, seasonYear, horizon = 4) {
  const target = normalizeName(teamName);
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : []).filter((pick) => {
    const owner = normalizeName(pick?.owner || pick?.currentOwner || pick?.owningTeam || pick?.teamName || pick?.team);
    const year = safeNumber(pick?.year ?? pick?.draftYear ?? pick?.season, 0);
    const round = safeNumber(pick?.round, 0);
    const active = !pick?.status || normalizeName(pick.status) === "active";
    return owner === target && round === 1 && active && year >= seasonYear + 1 && year <= seasonYear + horizon;
  }).length;
}

function recentRookies(team, seasonYear) {
  return getRoster(team).map((player) => ({
    name: playerNameOf(player),
    pos: playerPosition(player),
    ovr: playerOverall(player),
    pot: playerPotential(player),
    draftYear: safeNumber(player?.draftYear ?? player?.draftClassYear ?? player?.rookieSeasonYear, 0),
    age: playerAge(player),
  })).filter((row) => row.draftYear === seasonYear || (row.age > 0 && row.age <= 21 && row.pot >= 80))
    .sort((a, b) => b.pot - a.pot || b.ovr - a.ovr)
    .slice(0, 4);
}

function positionNeed(snapshot) {
  const groups = [
    { label:"lead guard", test:(pos)=>pos.includes("PG") },
    { label:"two-way wing", test:(pos)=>pos.includes("SG") || pos.includes("SF") },
    { label:"forward", test:(pos)=>pos.includes("PF") },
    { label:"center", test:(pos)=>pos.includes("C") },
  ];
  return groups.map((group) => {
    const players = snapshot.roster.filter((row) => group.test(row.pos));
    return { ...group, best: players[0]?.ovr || 55, playable: players.filter((row) => row.ovr >= 75).length };
  }).sort((a, b) => (a.best + a.playable * 3) - (b.best + b.playable * 3))[0]?.label || "rotation depth";
}

function teamActivity(leagueData, teamName, seasonYear, trades, signings) {
  const target = normalizeName(teamName);
  const incomingTrades = trades.filter((event) => normalizeName(event.toTeam) === target);
  const outgoingTrades = trades.filter((event) => normalizeName(event.fromTeam) === target);
  const teamSignings = signings.filter((event) => normalizeName(event.toTeam) === target);
  const significant = [...incomingTrades, ...outgoingTrades, ...teamSignings].sort((a, b) => b.score - a.score);
  return { incomingTrades, outgoingTrades, signings:teamSignings, significant };
}

function buildLeagueEventBoard({ leagueData, seasonYear, previousEntry, progressionRows }) {
  const trades = recentTradeEvents(leagueData, seasonYear);
  const signings = freeAgencyEvents(leagueData, seasonYear);
  const retirements = retirementEvents(leagueData, seasonYear);
  const progression = progressionRows.filter((row) => Math.abs(row.delta) >= 3 && row.currentOverall >= 78).map((row) => ({
    type: row.delta > 0 ? "breakout" : "regression",
    score: 64 + Math.min(22, Math.abs(row.delta) * 4) + Math.max(0, row.currentOverall - 82),
    playerName: row.name,
    teamName: row.teamName,
    headline: row.delta > 0
      ? `${row.name} jumped ${row.delta} overall points to ${row.currentOverall} OVR for ${row.teamName}`
      : `${row.name} fell ${Math.abs(row.delta)} overall points to ${row.currentOverall} OVR for ${row.teamName}`,
  }));
  const events = [
    ...leagueHistoryEvents(leagueData, seasonYear, previousEntry),
    ...standoutTeamEvents(previousEntry),
    ...trades,
    ...signings,
    ...retirements,
    ...progression,
  ].sort((a, b) => b.score - a.score);
  const seen = new Set();
  return {
    trades, signings, retirements,
    events: events.filter((event) => {
      const key = normalizeName(event.headline);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 18),
  };
}

function continuityAssessment(prior, current) {
  const old = prior?.dossier?.primaryStoryline;
  if (!old) return null;
  const subject = text(old.subject);
  const currentNames = new Set(current.snapshot.roster.map((row) => normalizeName(row.name)));
  let status = "continuing";
  let evidence = "";
  if (old.type === "star_window" && subject && !currentNames.has(normalizeName(subject))) {
    status = "reversed";
    evidence = `${subject} is no longer on the roster`;
  } else if (current.previousRow?.champion || current.previousRow?.finals) {
    status = "resolved";
    evidence = `${current.canonical} ${formatFinish(current.previousRow)}`;
  } else if (old.type === "star_window" && current.previousRow && !current.previousRow?.conferenceFinals) {
    status = "escalated";
    evidence = `${current.canonical} finished ${formatRecord(current.previousRow)} and ${formatFinish(current.previousRow)}`;
  } else if (old.type === "development" && current.teamProgression.some((row) => row.delta >= 3)) {
    status = "progressed";
    const row = current.teamProgression.find((item) => item.delta >= 3);
    evidence = `${row.name} rose ${row.delta} OVR points`;
  } else if (current.previousRow) {
    evidence = `${current.canonical} finished ${formatRecord(current.previousRow)} and ${formatFinish(current.previousRow)}`;
  }
  return { ...old, status, evidence };
}

function primaryStoryline(context) {
  const topIncoming = context.activity.significant.find((event) => event.toTeam && normalizeName(event.toTeam) === normalizeName(context.canonical) && event.overall >= 84);
  const topOutgoing = context.activity.outgoingTrades.find((event) => event.overall >= 84);
  const topDeparture = context.turnover?.departures?.find((row) => row.previousOverall >= 84);
  const top = context.snapshot.top[0];
  if (context.previousRow?.champion) return { type:"title_defense", subject:context.canonical, question:`Can ${context.canonical} defend the championship?` };
  if (topDeparture) {
    const destination = topDeparture.destination ? ` to ${topDeparture.destination}` : "";
    return { type:"roster_reset", subject:topDeparture.name, question:`How does ${context.canonical} replace ${topDeparture.name} after losing him${destination}?` };
  }
  if (topIncoming) return { type:"roster_reset", subject:topIncoming.playerName, question:`How far can ${context.canonical} go after adding ${topIncoming.playerName}?` };
  if (topOutgoing) return { type:"roster_reset", subject:topOutgoing.playerName, question:`What becomes of ${context.canonical} after moving ${topOutgoing.playerName}?` };
  if (top?.ovr >= 87 && top?.age >= 28) return { type:"star_window", subject:top.name, question:`Can ${context.canonical} maximize ${top.name}'s prime before the window changes?` };
  if (context.snapshot.youngCore.length >= 2) return { type:"development", subject:context.snapshot.youngCore[0]?.name, question:`Which part of ${context.canonical}'s young core becomes the next real centerpiece?` };
  return { type:"direction", subject:top?.name || context.canonical, question:`What did ${context.canonical} actually learn about its direction last season?` };
}

function buildTeamParagraphs(context) {
  const { canonical, previousRow, previousStats, snapshot, activity, teamProgression, continuity, turnover } = context;
  const record = formatRecord(previousRow);
  const finish = formatFinish(previousRow);
  const leader = previousStats[0];
  const leaderLine = leader && formatStatLine(leader) ? `${leader.name} led the season at ${formatStatLine(leader)}.` : "";
  const first = previousRow
    ? `${canonical} closed last season ${record ? `${record} ` : ""}and ${finish}. ${leaderLine}`.trim()
    : `${canonical} enters the year without a complete prior-season archive, so the current roster has to establish the story from here.`;

  const additions = uniqueNames([
    ...activity.incomingTrades.map((event) => event.playerName),
    ...activity.signings.map((event) => event.playerName),
  ], 4);
  const departures = uniqueNames([
    ...activity.outgoingTrades.map((event) => event.playerName),
    ...(turnover?.departures || []).map((row) => row.name),
  ], 4);
  const departureDetails = (turnover?.departures || [])
    .filter((row) => departures.includes(row.name))
    .slice(0, 2)
    .map((row) => row.destination ? `${row.name} is now with ${row.destination}` : `${row.name} is no longer on the roster`);
  const prog = teamProgression.slice(0, 3).map((row) => `${row.name} ${row.delta > 0 ? "rose" : "fell"} ${Math.abs(row.delta)} OVR to ${row.currentOverall}`);
  const movement = [
    additions.length ? `The offseason added ${naturalList(additions)}.` : "",
    departureDetails.length ? `${departureDetails.join("; ")}.` : departures.length ? `${naturalList(departures)} left the roster.` : "",
    prog.length ? `${prog.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
  const topNames = snapshot.top.slice(0, 3).map((row) => `${row.name} (${row.ovr} OVR${row.age ? `, age ${row.age}` : ""})`);
  const second = `${movement || "The offseason produced no saved blockbuster transaction, making internal development the largest change."} The current hierarchy starts with ${naturalList(topNames) || "an unsettled rotation"}.`;

  const continuityLead = continuity?.evidence
    ? `Last year's central question has ${continuity.status === "escalated" ? "become more urgent" : continuity.status === "resolved" ? "been answered at the highest level" : continuity.status === "reversed" ? "changed completely" : "carried forward"}: ${continuity.evidence}.`
    : "";
  const third = `${continuityLead} ${context.primaryStoryline.question}`.trim();
  return [first, second, third];
}

function buildLeagueParagraphs(context) {
  const { canonical, leagueBoard, previousEntry, snapshot } = context;
  const champ = text(previousEntry?.champion);
  const firstEvents = leagueBoard.events.filter((event) => ["champion","award","team_season"].includes(event.type)).slice(0, 3);
  const first = firstEvents.length
    ? firstEvents.map((event) => `${event.headline}.`).join(" ")
    : champ ? `${champ} begins the year as defending champion.` : "The previous season archive does not preserve one complete headline, so the league hierarchy has to be read through the current rosters.";

  const movement = leagueBoard.events.filter((event) => ["trade","free_agency","retirement","breakout","regression"].includes(event.type)).slice(0, 4);
  const second = movement.length
    ? movement.map((event) => `${event.headline}.`).join(" ")
    : "No single saved transaction or progression event dominates the league-wide ledger entering this season.";

  const peers = getAllTeams(context.leagueData).map((team) => ({ name:teamNameOf(team), snap:rosterSnapshot(team) }))
    .sort((a,b)=>(b.snap.average + (b.snap.top[0]?.ovr||0)*0.15) - (a.snap.average + (a.snap.top[0]?.ovr||0)*0.15));
  const rank = peers.findIndex((row) => normalizeName(row.name) === normalizeName(canonical)) + 1;
  const nearby = peers.filter((row) => normalizeName(row.name) !== normalizeName(canonical)).slice(Math.max(0, rank - 3), Math.max(3, rank + 1)).map((row)=>row.name).slice(0,3);
  const third = `${canonical} open with a rotation averaging ${snapshot.average.toFixed(1)} OVR and sits roughly ${rank ? `#${rank}` : "in the middle"} by current roster strength. ${nearby.length ? `${naturalList(nearby)} are among the teams occupying the same immediate competitive map.` : "The current roster has to define its own tier quickly."}`;
  return [first, second, third];
}

function buildProspectParagraphs(context) {
  const { canonical, draft, firstRoundPicks, snapshot, recentRookieRows } = context;
  const boardNames = draft.rows.slice(0, 5).map((row) => `${row.name} (${row.position}, ${row.overall}/${row.potential})`);
  const first = draft.rows.length
    ? `The ${draft.draftYear} board is already live. ${naturalList(boardNames)} currently occupy the first tier of the saved class.`
    : `The ${draft.draftYear} class has not been generated in this save yet. New Chapter will attach the live board as soon as Upcoming Draft prepares it.`;
  const capital = firstRoundPicks.length === 0
    ? `${canonical} does not currently control a listed first-round pick in ${draft.draftYear}.`
    : firstRoundPicks.length === 1
      ? `${canonical} currently controls one listed first-round pick in ${draft.draftYear}.`
      : `${canonical} currently controls ${firstRoundPicks.length} listed first-round picks in ${draft.draftYear}.`;
  const second = `${capital} The clearest roster need by current depth is ${positionNeed(snapshot)}.`;
  const recent = recentRookieRows.length
    ? `${naturalList(recentRookieRows.map((row) => `${row.name} (${row.ovr} OVR, ${row.pot} POT)`), "and")} ${recentRookieRows.length === 1 ? "is" : "are"} the newest young ${recentRookieRows.length === 1 ? "piece" : "pieces"} already on the roster.`
    : "There is no clearly tagged recent rookie in the current roster data, so the upcoming class carries more of the prospect focus.";
  return [first, second, recent];
}

function buildOutlookParagraphs(context) {
  const { canonical, snapshot, previousRow, activity, futureFirsts, continuity, primaryStoryline:story } = context;
  const top = snapshot.top[0]; const secondStar = snapshot.top[1];
  const core = snapshot.top.slice(0,3).map((row)=>`${row.name} (${row.ovr} OVR${row.age?`, age ${row.age}`:""})`);
  const first = `${canonical} begins ${seasonLabel(context.seasonYear)} around ${naturalList(core) || "an unsettled core"}. ${previousRow ? `That group inherits a ${formatRecord(previousRow)} season that ${formatFinish(previousRow)}.` : "There is no complete previous result in the archive."}`;
  let pressure = "";
  if (top?.ovr >= 87 && top?.age >= 30) pressure = `${top.name} is ${top.age}, so the best player on the roster is already in a win-now age band.`;
  else if (snapshot.youngCore.length >= 2) pressure = `${snapshot.youngCore[0].name} and ${snapshot.youngCore[1].name} give the franchise multiple high-level players age 25 or younger.`;
  else if (snapshot.direction === "rebuilding") pressure = `The rotation grades below contender level and the season should be judged by how much real core talent emerges.`;
  else pressure = `The roster is neither an obvious teardown nor a finished contender, which makes the next major move unusually important.`;
  const second = `${pressure} The team controls ${futureFirsts} listed first-round pick${futureFirsts === 1 ? "" : "s"} over the next four drafts, giving the front office ${futureFirsts >= 3 ? "real ammunition" : futureFirsts ? "some flexibility" : "very little draft insulation"}.`;
  const starMove = activity.significant.find((event)=>event.overall >= 84);
  const evidence = starMove ? `${starMove.headline}.` : continuity?.evidence ? `${continuity.evidence}.` : "";
  const agePair = top && secondStar ? `${top.name}/${secondStar.name}` : top?.name || "the core";
  const third = `${evidence} The management question is specific: ${story.question} Every trade, extension and rotation decision should be judged against what it does to the ${agePair} timeline.`.trim();
  return [first, second, third];
}

export function buildSeasonBriefingData(leagueData, teamName, explicitYear = null) {
  const seasonYear = getSeasonBriefingSeasonYear(leagueData, explicitYear);
  const canonical = canonicalTeamName(teamName) || text(teamName);
  const team = findTeam(leagueData, canonical);
  if (!seasonYear || !canonical || !team) return null;

  const draft = currentDraftPreview(leagueData, seasonYear);
  const firstSeason = seasonYear === 2026 ? getFirstSeasonBriefing2026(canonical) : null;
  const prospectRows = draft.rows;
  if (firstSeason) {
    return {
      contentVersion: SEASON_BRIEFING_CONTENT_VERSION,
      leagueScope: getSeasonBriefingLeagueScope(leagueData),
      key: getSeasonBriefingKey(leagueData, canonical, seasonYear),
      teamName: canonical,
      teamSlug: getSeasonBriefingTeamSlug(canonical),
      seasonYear,
      seasonLabel: seasonLabel(seasonYear),
      source: "handcrafted_2026",
      tabs: {
        team: { ...firstSeason.team },
        league: { ...firstSeason.league, progression:{ improved:[], regressed:[] } },
        prospects: { ...firstSeason.prospects, prospects:prospectRows, classCount:draft.classCount, draftYear:draft.draftYear },
        outlook: { ...firstSeason.outlook },
      },
    };
  }

  const previousEntry = getPreviousSeasonEntry(leagueData, seasonYear);
  const previousRow = previousTeamRow(previousEntry, canonical);
  const snapshot = rosterSnapshot(team);
  const progressionRows = readProgressionRows(leagueData, seasonYear);
  const progression = progressionLeaders(progressionRows, 10);
  const teamProgressionRows = teamProgression(progressionRows, canonical);
  const leagueBoard = buildLeagueEventBoard({ leagueData, seasonYear, previousEntry, progressionRows });
  const activity = teamActivity(leagueData, canonical, seasonYear, leagueBoard.trades, leagueBoard.signings);
  const previousStats = previousTeamPlayerStats(previousEntry, canonical);
  const turnover = rosterTurnover(leagueData, snapshot, previousStats, canonical, seasonYear);
  const firstRoundPicks = ownedFirstRoundPicks(leagueData, canonical, draft.draftYear);
  const futureFirsts = totalFutureFirsts(leagueData, canonical, seasonYear, 4);
  const recentRookieRows = recentRookies(team, seasonYear);

  const context = {
    leagueData, seasonYear, canonical, team, previousEntry, previousRow, snapshot,
    progressionRows, progression, teamProgression:teamProgressionRows,
    leagueBoard, activity, previousStats, turnover, draft, firstRoundPicks, futureFirsts,
    recentRookieRows,
  };
  const prior = previousStoredSnapshot(leagueData, canonical, seasonYear);
  const story = primaryStoryline(context);
  context.primaryStoryline = story;
  context.continuity = continuityAssessment(prior, context);

  const dossier = {
    version: 2,
    generatedFrom: "save_events",
    seasonYear,
    previousSeasonYear: previousEntry?.seasonYear ?? null,
    previousRecord: formatRecord(previousRow),
    previousFinish: formatFinish(previousRow),
    topPlayers: snapshot.top.map(({ name, ovr, age, pot, pos }) => ({ name, ovr, age, pot, pos })),
    previousStatLeaders: previousStats.slice(0, 3).map((row) => ({ name:row.name, statLine:formatStatLine(row) })),
    rosterTurnover: {
      departures: turnover.departures.slice(0, 5),
      arrivals: turnover.arrivals.slice(0, 5),
    },
    teamProgression: teamProgressionRows,
    significantTeamMoves: activity.significant.slice(0, 6).map((event) => ({ type:event.type, headline:event.headline, overall:event.overall || 0 })),
    leagueHeadlines: leagueBoard.events.slice(0, 8).map((event) => ({ type:event.type, headline:event.headline, score:event.score })),
    draftYear: draft.draftYear,
    draftClassCount: draft.classCount,
    futureFirsts,
    continuity: context.continuity,
    primaryStoryline: {
      ...story,
      teamSlug: getSeasonBriefingTeamSlug(canonical),
      teamName: canonical,
      seasonYear,
      status: context.continuity?.status || "new",
    },
  };

  return {
    contentVersion: SEASON_BRIEFING_CONTENT_VERSION,
    leagueScope: getSeasonBriefingLeagueScope(leagueData),
    key: getSeasonBriefingKey(leagueData, canonical, seasonYear),
    teamName: canonical,
    teamSlug: getSeasonBriefingTeamSlug(canonical),
    seasonYear,
    seasonLabel: seasonLabel(seasonYear),
    source: "event_dossier_v2",
    dossier,
    tabs: {
      team: { eyebrow:"TEAM BRIEFING", title:canonical, paragraphs:buildTeamParagraphs(context) },
      league: { eyebrow:"LEAGUE LANDSCAPE", title:"What changed around the league", paragraphs:buildLeagueParagraphs(context), progression },
      prospects: { eyebrow:"PROSPECTS & PICKS", title:`The ${draft.draftYear} board`, paragraphs:buildProspectParagraphs(context), prospects:prospectRows, classCount:draft.classCount, draftYear:draft.draftYear },
      outlook: { eyebrow:"SEASON OUTLOOK", title:"What this season asks", paragraphs:buildOutlookParagraphs(context) },
    },
  };
}

export function getSeasonBriefingDiagnostics(leagueData, teamName, explicitYear = null) {
  const briefing = buildSeasonBriefingData(leagueData, teamName, explicitYear);
  return briefing ? {
    key: briefing.key,
    source: briefing.source,
    teamName: briefing.teamName,
    seasonYear: briefing.seasonYear,
    dossier: briefing.dossier || null,
    paragraphCounts: Object.fromEntries(Object.entries(briefing.tabs || {}).map(([key, tab]) => [key, tab?.paragraphs?.length || 0])),
  } : null;
}
