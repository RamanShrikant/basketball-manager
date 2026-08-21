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

export const SEASON_BRIEFING_CONTENT_VERSION = 8;
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

function conferenceNameOf(team) {
  const raw = text(team?.conference || team?.conf || team?.conferenceName);
  const normalized = normalizeName(raw);
  if (normalized.includes("east")) return "East";
  if (normalized.includes("west")) return "West";
  return raw;
}

function conferenceDisplayName(value) {
  const normalized = normalizeName(value);
  if (normalized.includes("east")) return "Eastern Conference";
  if (normalized.includes("west")) return "Western Conference";
  return text(value) || "conference";
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

function possessive(value) {
  const source = text(value);
  if (!source) return "";
  return /s$/i.test(source) ? `${source}'` : `${source}'s`;
}

function sentenceCase(value) {
  const source = text(value);
  return source ? `${source.charAt(0).toUpperCase()}${source.slice(1)}` : "";
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
        stats: row?.stats || {},
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
      source: row?.source || null,
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

function getBriefingContractYear(leagueData) {
  const candidates = [
    leagueData?.contractSeasonYear,
    leagueData?.financials?.contractSeasonYear,
    leagueData?.seasonStartYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonYear,
    getSeasonStartYear(leagueData || {}),
  ];
  for (const value of candidates) {
    const year = safeNumber(value, 0);
    if (year >= 2020 && year <= 2100) return Math.trunc(year);
  }
  return 0;
}

function playerContract(player) {
  return player?.contract && typeof player.contract === "object" ? player.contract : {};
}

function contractYearsLeft(player, leagueData) {
  const direct = safeNumber(player?.yearsLeft ?? player?.contractYears, -1);
  if (direct >= 0) return Math.max(0, Math.round(direct));
  const contract = playerContract(player);
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;
  const currentYear = getBriefingContractYear(leagueData);
  const startYear = safeNumber(contract?.startYear, currentYear);
  let index = currentYear - startYear;
  if (!Number.isFinite(index) || index < 0) index = 0;
  if (index >= salaries.length) return 0;
  return Math.max(0, salaries.length - index);
}

function currentContractSalary(player, leagueData) {
  const contract = playerContract(player);
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  if (salaries.length) {
    const currentYear = getBriefingContractYear(leagueData);
    const startYear = safeNumber(contract?.startYear, currentYear);
    let index = currentYear - startYear;
    if (!Number.isFinite(index) || index < 0) index = 0;
    if (index >= salaries.length) index = salaries.length - 1;
    return safeNumber(salaries[index], 0);
  }
  return safeNumber(player?.salary ?? player?.currentSalary ?? player?.contractSalary ?? player?.capHit ?? player?.aav, 0);
}

function compactMoney(value) {
  const amount = safeNumber(value, 0);
  if (!amount) return "";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2).replace(/\.0$/, "")}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function contractOriginalTerm(player) {
  const contract = playerContract(player);
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const explicit = safeNumber(
    contract?.originalTermYears ??
    contract?.termYears ??
    contract?.years ??
    meta?.originalTermYears ??
    meta?.contractYears,
    0
  );
  if (explicit > 0) return Math.round(explicit);
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  return salaries.length;
}

function hasFutureExtension(player, leagueData) {
  const contract = playerContract(player);
  const currentYear = getBriefingContractYear(leagueData);
  const rows = [
    ...(Array.isArray(contract?.extensions) ? contract.extensions : []),
    ...(contract?.extensionMeta && typeof contract.extensionMeta === "object" ? [contract.extensionMeta] : []),
  ];
  return rows.some((row) => safeNumber(row?.extensionStartYear, 0) > currentYear);
}

function unresolvedContractOption(player, leagueData) {
  const contract = playerContract(player);
  const option = contract?.option && typeof contract.option === "object" ? contract.option : null;
  if (!option || option.picked != null) return false;
  const years = Array.isArray(option.yearIndices) ? option.yearIndices : [];
  if (!years.length) return false;
  const currentYear = getBriefingContractYear(leagueData);
  const startYear = safeNumber(contract?.startYear, currentYear);
  const currentIndex = Math.max(0, currentYear - startYear);
  return years.some((index) => safeNumber(index, -99) >= currentIndex);
}

function buildExtensionWatch(team, leagueData) {
  const currentYear = getBriefingContractYear(leagueData);
  return getRoster(team)
    .map((player) => {
      const contract = playerContract(player);
      const yearsLeft = contractYearsLeft(player, leagueData);
      const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
      if (!salaries.length || yearsLeft <= 0 || hasFutureExtension(player, leagueData)) return null;
      if (unresolvedContractOption(player, leagueData)) return null;
      const status = normalizeName(player?.contractType || player?.rosterStatus || contract?.type || "standard");
      if (["two way", "two-way", "stash"].includes(status)) return null;

      const rights = player?.rights && typeof player.rights === "object" ? player.rights : {};
      const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
      const draftRound = safeNumber(meta?.draftRound ?? player?.draftRound, 0);
      const rookieScale = Boolean(rights?.rookieScale || player?.rookieScale || contract?.rookieScale);
      const originalTerm = contractOriginalTerm(player);
      let extensionType = "";
      if (rookieScale && draftRound === 1 && yearsLeft === 1) {
        extensionType = "rookie-scale";
      } else if (!rookieScale && originalTerm >= 3 && (yearsLeft === 1 || (yearsLeft === 2 && originalTerm >= 4))) {
        extensionType = "veteran";
      }
      if (!extensionType) return null;

      const endYear = currentYear + yearsLeft - 1;
      return {
        name: playerNameOf(player),
        overall: playerOverall(player),
        age: playerAge(player),
        yearsLeft,
        endYear,
        salary: currentContractSalary(player, leagueData),
        extensionType,
        headline: `${playerNameOf(player)} (${playerOverall(player)} OVR) is in the ${extensionType} extension window with ${yearsLeft} contract year${yearsLeft === 1 ? "" : "s"} remaining.`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.overall - a.overall || a.age - b.age || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function positionFitScore(player, snapshot) {
  const pos = playerPosition(player);
  if (!pos) return 0;
  const groupScore = (test) => {
    const rows = snapshot.roster.filter((row) => test(row.pos));
    const best = rows[0]?.ovr || 55;
    const playable = rows.filter((row) => row.ovr >= 75).length;
    return Math.max(0, 88 - best) + Math.max(0, 2 - playable) * 4;
  };
  if (pos.includes("PG")) return groupScore((value) => value.includes("PG"));
  if (pos.includes("SG") || pos.includes("SF")) return groupScore((value) => value.includes("SG") || value.includes("SF"));
  if (pos.includes("PF")) return groupScore((value) => value.includes("PF"));
  if (pos.includes("C")) return groupScore((value) => value.includes("C"));
  return 0;
}

function buildExpiringTradeTargets(leagueData, userTeamName, userSnapshot) {
  const userKey = normalizeName(userTeamName);
  const candidates = [];
  for (const team of getAllTeams(leagueData)) {
    const sourceTeamName = teamNameOf(team);
    if (!sourceTeamName || normalizeName(sourceTeamName) === userKey) continue;
    const sourceRoster = getRoster(team)
      .slice()
      .sort((a, b) => playerOverall(b) - playerOverall(a) || playerAge(a) - playerAge(b));
    const topNames = new Set(sourceRoster.slice(0, 2).map((player) => normalizeName(playerNameOf(player))));
    const sourceSnapshot = rosterSnapshot(team);

    for (const player of sourceRoster) {
      const yearsLeft = contractYearsLeft(player, leagueData);
      const salary = currentContractSalary(player, leagueData);
      const ovr = playerOverall(player);
      const age = playerAge(player);
      if (yearsLeft !== 1 || salary <= 0 || ovr < 74) continue;
      const topTwo = topNames.has(normalizeName(playerNameOf(player)));
      if (topTwo && ovr >= 87 && age <= 29) continue;

      const fit = positionFitScore(player, userSnapshot);
      const sourceFlex =
        sourceSnapshot.direction === "rebuilding" ? 9 :
        sourceSnapshot.direction === "developing" ? 4 :
        sourceSnapshot.direction === "retooling" ? 2 : -3;
      const veteranFlex = age >= 29 ? 4 : 0;
      const starPenalty = topTwo ? 8 : 0;
      const score = ovr * 1.25 + fit + sourceFlex + veteranFlex - starPenalty;

      candidates.push({
        name: playerNameOf(player),
        teamName: sourceTeamName,
        overall: ovr,
        age,
        pos: playerPosition(player),
        salary,
        yearsLeft,
        fitScore: fit,
        sourceDirection: sourceSnapshot.direction,
        score,
        headline: `${playerNameOf(player)} — ${sourceTeamName}, ${ovr} OVR, age ${age || "—"}, expiring at ${compactMoney(salary) || "an active salary"}.`,
      });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score || b.overall - a.overall || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function archivedPlayerIndex(previousEntry) {
  const index = new Map();
  for (const row of archivedPlayerRows(previousEntry)) {
    const name = playerNameOf(row);
    const key = normalizeName(name);
    if (!key) continue;
    const existing = index.get(key);
    const next = {
      name,
      teamName: text(row?.teamName || row?.team),
      overall: playerOverall(row),
      age: playerAge(row),
      stats: row?.stats || {},
    };
    if (!existing || next.overall > existing.overall) index.set(key, next);
  }
  return index;
}

function rosterShiftEvents(leagueData, previousEntry) {
  if (!previousEntry) return [];
  const currentIndex = playerIndex(leagueData);
  const events = [];
  for (const previousTeam of previousEntry?.teams || []) {
    const teamName = text(previousTeam?.teamName || previousTeam?.team || previousTeam?.name);
    const currentTeam = findTeam(leagueData, teamName);
    if (!teamName || !currentTeam) continue;

    const previousRows = previousTeamPlayerStats(previousEntry, teamName)
      .slice()
      .sort((a, b) => b.overall - a.overall || safeNumber(b?.stats?.PTS ?? b?.stats?.ppg, 0) - safeNumber(a?.stats?.PTS ?? a?.stats?.ppg, 0))
      .slice(0, 7);
    if (!previousRows.length) continue;

    const currentNames = new Set(getRoster(currentTeam).map((player) => normalizeName(playerNameOf(player))));
    const departed = previousRows.filter((row) => !currentNames.has(normalizeName(row.name)));
    const meaningfulDepartures = departed.filter((row) => row.overall >= 78 || safeNumber(row?.stats?.PTS ?? row?.stats?.ppg, 0) >= 14);
    if (!meaningfulDepartures.length) continue;

    const previousNames = new Set(previousRows.map((row) => normalizeName(row.name)));
    const arrivals = getRoster(currentTeam)
      .filter((player) => !previousNames.has(normalizeName(playerNameOf(player))) && playerOverall(player) >= 78)
      .sort((a, b) => playerOverall(b) - playerOverall(a))
      .slice(0, 4);

    const lostValue = meaningfulDepartures.reduce((sum, row) => sum + Math.max(0, row.overall - 70) + safeNumber(row?.stats?.PTS ?? row?.stats?.ppg, 0) * 0.35, 0);
    const gainedValue = arrivals.reduce((sum, player) => sum + Math.max(0, playerOverall(player) - 70), 0);
    const netLoss = lostValue - gainedValue;
    const starLoss = meaningfulDepartures.some((row) => row.overall >= 84);
    if (!starLoss && meaningfulDepartures.length < 2 && netLoss < 16) continue;

    const departureText = meaningfulDepartures.slice(0, 3).map((row) => {
      const now = currentIndex.get(normalizeName(row.name));
      return now?.teamName && normalizeName(now.teamName) !== normalizeName(teamName)
        ? `${row.name} to ${now.teamName}`
        : row.name;
    });
    const incomingText = arrivals.slice(0, 2).map((player) => playerNameOf(player));
    const severity =
      netLoss >= 28 || (starLoss && meaningfulDepartures.length >= 2) ? "core collapse" :
      netLoss >= 16 || starLoss ? "major reset" : "rotation reset";
    const currentTop = rosterSnapshot(currentTeam).top[0];

    events.push({
      type: "franchise_shift",
      score: 72 + Math.min(28, Math.round(netLoss)) + (starLoss ? 6 : 0),
      teamName,
      severity,
      departed: meaningfulDepartures.slice(0, 4).map((row) => row.name),
      arrivals: arrivals.map((player) => playerNameOf(player)),
      headline: `${teamName} entered a ${severity} after losing ${naturalList(departureText)}${incomingText.length ? ` while adding ${naturalList(incomingText)}` : ""}${currentTop ? `; ${currentTop.name} now headlines the roster` : ""}`,
    });
  }
  return events.sort((a, b) => b.score - a.score || a.teamName.localeCompare(b.teamName)).slice(0, 6);
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

function recentTradeEvents(leagueData, seasonYear, previousEntry = null) {
  const liveIndex = playerIndex(leagueData);
  const archivedIndex = archivedPlayerIndex(previousEntry);
  const rows = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  const events = [];
  rows.slice(-120).forEach((row, rowIndex) => {
    const rowYear = safeNumber(row?.seasonYear, 0);
    if (rowYear && rowYear < seasonYear - 1) return;
    for (const move of getTradeMoves(row)) {
      const live = liveIndex.get(normalizeName(move.name));
      const archived = archivedIndex.get(normalizeName(move.name));
      const ovr = Math.max(
        safeNumber(live?.overall, 0),
        safeNumber(archived?.overall, 0),
        safeNumber(row?.overall, 0)
      );
      const ppg = safeNumber(archived?.stats?.PTS ?? archived?.stats?.ppg, 0);
      const score =
        (ovr >= 90 ? 104 : ovr >= 86 ? 96 : ovr >= 82 ? 86 : ovr >= 78 ? 72 : 58) +
        Math.min(8, Math.max(0, ppg - 16) * 0.5);
      events.push({
        type: "trade",
        score,
        playerName: move.name,
        fromTeam: move.fromTeam,
        toTeam: move.toTeam,
        overall: ovr,
        previousPpg: ppg,
        date: text(row?.currentDate || row?.date || row?.leagueDate || ""),
        phase: tradePhaseFromRecord(row),
        rowIndex,
        headline: `${move.toTeam} acquired ${move.name}${ovr ? ` (${ovr} OVR)` : ""} from ${move.fromTeam}`,
      });
    }
  });
  return events.sort((a, b) => b.score - a.score || b.overall - a.overall || b.rowIndex - a.rowIndex);
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
    const contract = row?.contract && typeof row.contract === "object"
      ? row.contract
      : playerContract(player);
    const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
    const years = salaries.length || safeNumber(row?.years, 0);
    const aav = safeNumber(
      row?.aav,
      salaries.length ? salaries.reduce((sum, value) => sum + safeNumber(value, 0), 0) / salaries.length : 0
    );
    const contractText = years
      ? ` on a ${years}-year${aav ? `, ${compactMoney(aav)} AAV` : ""} deal`
      : "";
    out.push({
      type: "free_agency",
      score: ovr >= 90 ? 102 : ovr >= 86 ? 94 : ovr >= 82 ? 84 : ovr >= 78 ? 70 : 55,
      playerName: name,
      toTeam: teamName,
      overall: ovr,
      years,
      aav,
      headline: `${teamName} signed ${name}${ovr ? ` (${ovr} OVR)` : ""}${contractText}`,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.overall - a.overall || a.playerName.localeCompare(b.playerName));
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

function tradePhaseFromRecord(row = {}) {
  const phaseText = normalizeName(row?.phase || row?.seasonPhase || row?.tradePhase || row?.source || "");
  if (/offseason|off season|summer/.test(phaseText)) return "offseason";
  if (/regular|deadline|midseason|mid season|playoff/.test(phaseText)) return "in_season";
  if (row?.inOffseason === true || row?.offseason === true) return "offseason";

  const rawDate = text(row?.currentDate || row?.date || row?.leagueDate || row?.calendarDate);
  const match = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const month = Number(match[2]);
    if ([7, 8, 9].includes(month)) return "offseason";
    if ([10, 11, 12, 1, 2, 3, 4, 5, 6].includes(month)) return "in_season";
  }
  return "unknown";
}

function ratingLookup(player, aliases = []) {
  if (!player || typeof player !== "object") return 0;
  const sources = [player, player?.ratings, player?.attributes, player?.skills, player?.currentRatings]
    .filter((row) => row && typeof row === "object");
  for (const source of sources) {
    for (const alias of aliases) {
      const value = safeNumber(source?.[alias], NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  return 0;
}

function playerBasketballProfile(player) {
  if (!player) return { strengths: [], primary: "", position: "" };
  const position = playerPosition(player);
  const rows = [
    { key:"shooting", value:ratingLookup(player, ["3PT", "3pt", "three", "threePt", "threePoint", "threePointRating", "three_point", "rating3pt"]) },
    { key:"passing", value:ratingLookup(player, ["PASS", "pass", "passing", "passRating", "passingRating"]) },
    { key:"handling", value:ratingLookup(player, ["BALL", "ball", "ballHandle", "ballHandling", "handle", "dribble"]) },
    { key:"defense", value:ratingLookup(player, ["DEF", "def", "defense", "defRating", "defensiveRating"]) },
    { key:"rebounding", value:ratingLookup(player, ["REB", "reb", "rebound", "rebounding", "rebRating"]) },
    { key:"rim", value:ratingLookup(player, ["BLK", "blk", "block", "blocks", "blockRating"]) },
    { key:"finishing", value:ratingLookup(player, ["CLOSE", "close", "closeRating", "inside", "insideScoring", "finishing"]) },
    { key:"scoring", value:ratingLookup(player, ["OFF", "off", "offense", "offRating", "offensiveRating"]) },
  ].filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  return { strengths: rows, primary: rows[0]?.key || "", position };
}

function basketballFitPhrase(player, mode = "add") {
  const profile = playerBasketballProfile(player);
  const strong = profile.strengths.filter((row) => row.value >= 78).slice(0, 3).map((row) => row.key);
  const pos = profile.position;
  const isBig = pos.includes("C") || pos.includes("PF");
  const pieces = [];
  if (strong.includes("shooting")) pieces.push("floor spacing");
  if (strong.includes("passing") || strong.includes("handling")) pieces.push("another source of creation");
  if (strong.includes("defense")) pieces.push(isBig ? "a sturdier defensive backbone" : "point-of-attack and wing defense");
  if (strong.includes("rim")) pieces.push("rim protection");
  if (strong.includes("rebounding")) pieces.push("rebounding");
  if (strong.includes("finishing") || strong.includes("scoring")) pieces.push("scoring pressure");
  const useful = uniqueNames(pieces, 3);
  if (!useful.length) {
    const overall = playerOverall(player);
    if (overall >= 84) return mode === "remove" ? "removes a high-level two-way piece from the rotation" : "adds another high-level piece who can carry real responsibility";
    if (overall >= 78) return mode === "remove" ? "takes dependable rotation quality out of the lineup" : "adds dependable rotation quality without forcing the stars to absorb every possession";
    return mode === "remove" ? "takes away useful depth" : "adds useful depth";
  }
  const list = naturalList(useful);
  return mode === "remove" ? `takes away ${list}` : `adds ${list}`;
}

function roundedProductionText(row) {
  const stats = row?.stats || {};
  const ppg = safeNumber(stats?.PTS ?? stats?.ppg, NaN);
  const rpg = safeNumber(stats?.REB ?? stats?.rpg, NaN);
  const apg = safeNumber(stats?.AST ?? stats?.apg, NaN);
  const parts = [];
  if (Number.isFinite(ppg) && ppg >= 3) parts.push(`${Math.round(ppg)} point${Math.round(ppg) === 1 ? "" : "s"}`);
  if (Number.isFinite(rpg) && rpg >= 2) parts.push(`${Math.round(rpg)} rebound${Math.round(rpg) === 1 ? "" : "s"}`);
  if (Number.isFinite(apg) && apg >= 2) parts.push(`${Math.round(apg)} assist${Math.round(apg) === 1 ? "" : "s"}`);
  return parts.length ? `about ${naturalList(parts)} a night` : "";
}

function teamPlayerRow(context, playerName) {
  const target = normalizeName(playerName);
  return context?.snapshot?.roster?.find((row) => normalizeName(row.name) === target) || null;
}

function previousPlayerRow(context, playerName) {
  const target = normalizeName(playerName);
  return context?.previousStats?.find((row) => normalizeName(row.name) === target) || null;
}

function currentLeaguePlayer(context, playerName) {
  return playerIndex(context?.leagueData || {}).get(normalizeName(playerName)) || null;
}

function tradeAftermathSentence(context, event) {
  const canonical = context.canonical;
  const isIncoming = normalizeName(event?.toTeam) === normalizeName(canonical);
  const current = currentLeaguePlayer(context, event?.playerName);
  const currentStillHere = normalizeName(current?.teamName) === normalizeName(canonical);
  const previous = previousPlayerRow(context, event?.playerName);
  const production = roundedProductionText(previous);
  const overall = safeNumber(current?.overall, safeNumber(event?.overall, 0));
  const fit = basketballFitPhrase(current || previous || {}, isIncoming ? "add" : "remove");
  const phase = event?.phase || "unknown";

  if (isIncoming && phase === "in_season") {
    if (!currentStillHere) {
      return `The in-season trade for ${event.playerName} never became a lasting answer; he is already elsewhere, so the move now reads more like a short-term swing than a piece of the current foundation.`;
    }
    if (overall >= 83 || (previous && safeNumber(previous?.stats?.PTS ?? previous?.stats?.ppg, 0) >= 15)) {
      return `${choose(`${canonical}|${event.playerName}|trade-aged-well`, [
        `The in-season trade for ${event.playerName} has aged well`,
        `${event.playerName}'s midseason arrival looks better with a full offseason of distance`,
        `What looked like a deadline gamble on ${event.playerName} now feels much more settled`,
      ])}. ${production ? `By the end of last season he was giving ${canonical} ${production}, and he ${fit}.` : `In basketball terms, he ${fit}.`}`;
    }
    if (overall <= 74) {
      return `The in-season trade for ${event.playerName} has not aged especially well. His role never grew into what the move seemed to promise, and ${canonical} is still searching for more certainty in that part of the rotation.`;
    }
    return `The in-season trade for ${event.playerName} has settled into something useful rather than transformative. ${production ? `He finished the year around ${production}, and he ${fit}.` : `In basketball terms, he ${fit}.`}`;
  }

  if (isIncoming) {
    return `${choose(`${canonical}|${event.playerName}|trade-new`, [
      `${canonical} changed the shape of the roster by trading for ${event.playerName}`,
      `The trade for ${event.playerName} is one of the clearest changes to ${possessive(canonical)} identity`,
      `${event.playerName} arrives through trade with a real job to do immediately`,
    ])}. On paper, he ${fit}, giving the coaching staff a different set of answers than it had a year ago.`;
  }

  if (phase === "in_season") {
    return `Trading ${event.playerName} away during last season is still part of the story. ${overall >= 82 ? `He remains a high-level player elsewhere, so the cost of that decision is visible every time ${canonical} needs what he used to provide.` : `The move has become easier to live with as his value has settled, but it still changed the shape of the rotation.`}`;
  }
  return `${canonical} moved ${event.playerName} out of the picture. That decision ${fit}, forcing the remaining core to redistribute the possessions and matchups he used to handle.`;
}

function freeAgencyAdditionSentence(context, event) {
  const player = currentLeaguePlayer(context, event?.playerName);
  const fit = basketballFitPhrase(player || {}, "add");
  const contractNote = event?.years ? ` The ${event.years}-year commitment makes this more than a camp experiment.` : "";
  return `${choose(`${context.canonical}|${event.playerName}|fa-add`, [
    `${event.playerName} is the clearest new face from free agency`,
    `Free agency brought ${event.playerName} into the rotation`,
    `${context.canonical} used the open market to add ${event.playerName}`,
    `The offseason's most immediate fit change is ${event.playerName}`,
  ])}. He ${fit}, which should change how some of the surrounding lineups can function.${contractNote}`;
}

function freeAgencyDepartureSentence(context, departure) {
  const current = currentLeaguePlayer(context, departure?.name);
  const previous = previousPlayerRow(context, departure?.name) || departure;
  const production = roundedProductionText(previous);
  const fit = basketballFitPhrase(current || previous || {}, "remove");
  const destination = departure?.destination && normalizeName(departure.destination) !== "free agency"
    ? ` to ${departure.destination}`
    : "";
  return `${choose(`${context.canonical}|${departure?.name}|fa-loss`, [
    `The loss of ${departure.name}${destination} is not cosmetic`,
    `${context.canonical} will feel ${departure.name}'s departure${destination}`,
    `One of the real offseason subtractions is ${departure.name}${destination}`,
    `Free agency took ${departure.name}${destination} out of last year's rotation`,
  ])}. ${production ? `He had been giving the team ${production}, and losing him ` : "That exit "}${fit}.`;
}

function buildTeamTransactionStories(context) {
  const stories = [];
  const used = new Set();
  const add = (key, value) => {
    const normalized = normalizeName(key);
    if (!value || !normalized || used.has(normalized)) return;
    used.add(normalized);
    stories.push(value.replace(/\s+/g, " ").trim());
  };

  const trades = [...context.activity.incomingTrades, ...context.activity.outgoingTrades]
    .sort((a, b) => b.score - a.score);
  const signings = [...context.activity.signings].sort((a, b) => b.score - a.score);
  const tradedOut = new Set(context.activity.outgoingTrades.map((row) => normalizeName(row.playerName)));
  const faLosses = (context.turnover?.departures || [])
    .filter((row) => !tradedOut.has(normalizeName(row.name)))
    .filter((row) => safeNumber(row.previousOverall, 0) >= 76 || safeNumber(row?.stats?.PTS ?? row?.stats?.ppg, 0) >= 9)
    .slice(0, 4);

  // Put one major beat from each transaction lane up front so the prose cannot
  // become "three trade headlines" while ignoring the actual free-agent market.
  if (trades[0]) add(`trade|${trades[0].playerName}|${trades[0].fromTeam}|${trades[0].toTeam}`, tradeAftermathSentence(context, trades[0]));
  if (signings[0]) add(`signing|${signings[0].playerName}`, freeAgencyAdditionSentence(context, signings[0]));
  if (faLosses[0]) add(`departure|${faLosses[0].name}`, freeAgencyDepartureSentence(context, faLosses[0]));

  for (const event of trades.slice(1, 5)) {
    add(`trade|${event.playerName}|${event.fromTeam}|${event.toTeam}`, tradeAftermathSentence(context, event));
  }
  for (const event of signings.slice(1, 4)) {
    add(`signing|${event.playerName}`, freeAgencyAdditionSentence(context, event));
  }
  for (const row of faLosses.slice(1, 4)) add(`departure|${row.name}`, freeAgencyDepartureSentence(context, row));

  return stories.slice(0, 7);
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
  const trades = recentTradeEvents(leagueData, seasonYear, previousEntry);
  const signings = freeAgencyEvents(leagueData, seasonYear);
  const retirements = retirementEvents(leagueData, seasonYear);
  const franchiseShifts = rosterShiftEvents(leagueData, previousEntry);
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
    ...franchiseShifts,
    ...signings,
    ...retirements,
    ...progression,
  ].sort((a, b) => b.score - a.score);
  const seen = new Set();
  return {
    trades,
    signings,
    retirements,
    franchiseShifts,
    events: events.filter((event) => {
      const key = normalizeName(event.headline);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 24),
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

function buildOwnExpiringWatch(team, leagueData) {
  return getRoster(team)
    .map((player) => {
      const yearsLeft = contractYearsLeft(player, leagueData);
      const overall = playerOverall(player);
      if (yearsLeft !== 1 || overall < 74) return null;
      return {
        name: playerNameOf(player),
        overall,
        age: playerAge(player),
        salary: currentContractSalary(player, leagueData),
        yearsLeft,
        headline: `${playerNameOf(player)} (${overall} OVR) is entering the final guaranteed year of his current deal${currentContractSalary(player, leagueData) > 0 ? ` at ${compactMoney(currentContractSalary(player, leagueData))}` : ""}.`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.overall - a.overall || a.age - b.age || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function normalizeMoodPlayers(moodData) {
  const rows = Array.isArray(moodData?.players)
    ? moodData.players
    : Array.isArray(moodData?.moods)
      ? moodData.moods
      : [];
  return rows.map((row) => ({
    name: text(row?.playerName || row?.name || row?.player),
    score: safeNumber(row?.moodScore ?? row?.score ?? row?.mood, NaN),
    label: text(row?.moodLabel || row?.label || ""),
    trend: text(row?.trend || ""),
    reasons: Array.isArray(row?.reasons) ? row.reasons : [],
  })).filter((row) => row.name && Number.isFinite(row.score));
}

function moodReasonText(row) {
  const reason = [...(row?.reasons || [])]
    .filter((item) => text(item?.detail || item?.text || item?.category))
    .sort((a, b) => Math.abs(safeNumber(b?.impact, 0)) - Math.abs(safeNumber(a?.impact, 0)))[0];
  return text(reason?.detail || reason?.text || reason?.category).replace(/\?/g, ".");
}

function playoffMoodPhrase(previousRow) {
  const raw = normalizeName(previousRow?.playoffResult || "");
  if (raw.includes("firstround")) return "Last season's first-round exit";
  if (raw.includes("secondround")) return "Last season's second-round exit";
  if (raw.includes("conferencefinal")) return "Last season's conference-finals loss";
  if (raw.includes("playin")) return "Last season's Play-In exit";
  return previousRow?.madePlayoffs ? "Last season's playoff exit" : "Last season's finish";
}

function buildMoodPulse(moodData, previousRow, canonical) {
  const rows = normalizeMoodPlayers(moodData);
  if (!rows.length) return null;
  const average = rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
  const unsettled = rows.filter((row) => row.score < 55).sort((a, b) => a.score - b.score).slice(0, 3);
  const upbeat = rows.filter((row) => row.score >= 70).sort((a, b) => b.score - a.score).slice(0, 3);
  const falling = rows.filter((row) => normalizeName(row.trend) === "falling").length;
  let summary = "";
  if (average >= 74) {
    summary = `${canonical} opens camp with a genuinely upbeat locker room. The group is carrying confidence into the new season rather than dragging last year behind it.`;
  } else if (average >= 64) {
    summary = `${canonical} enters the season with a mostly positive locker room, although there are still individual concerns beneath the surface.`;
  } else if (average >= 54) {
    summary = `${canonical} enters camp with mixed emotions. The room is not fractured, but the mood is uneven enough that results early in the season will matter.`;
  } else {
    summary = `${canonical} opens the year with an uneasy locker room. Several players are carrying real frustration into the season, and the group needs a strong start to settle the atmosphere.`;
  }
  if (previousRow?.madePlayoffs && !previousRow?.champion && !previousRow?.finals && average < 62) {
    summary += ` ${playoffMoodPhrase(previousRow)} is still sitting poorly with parts of the roster.`;
  } else if ((previousRow?.conferenceFinals || previousRow?.finals || previousRow?.champion) && average >= 68) {
    summary += ` Last season's run has left the group believing it belongs in meaningful games again.`;
  }

  const items = [];
  for (const row of unsettled) {
    const reason = moodReasonText(row);
    items.push(`${row.name} is one of the more unsettled players in the room${row.trend ? ` and is trending ${row.trend}` : ""}${reason ? `; ${reason}` : ""}.`);
  }
  if (!items.length && upbeat.length) {
    items.push(`${naturalList(upbeat.map((row) => row.name))} ${upbeat.length === 1 ? "is" : "are"} among the strongest positive voices in the locker room entering the season.`);
  }
  if (falling >= 3 && average < 66) items.push(`${falling} players currently show a falling mood trend, so the emotional temperature of the room is worth monitoring early.`);
  return {
    average: Number(average.toFixed(1)),
    summary,
    items: items.slice(0, 4),
    unsettled: unsettled.map(({ name, score, label, trend }) => ({ name, score, label, trend })),
  };
}

function previousRotationAverage(previousEntry, teamName) {
  const rows = previousTeamPlayerStats(previousEntry, teamName).slice(0, 9);
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + safeNumber(row.overall, 0), 0) / rows.length;
}

function teamMoveEvidence(leagueBoard, teamName) {
  const target = normalizeName(teamName);
  return [...leagueBoard.trades, ...leagueBoard.signings]
    .filter((event) => normalizeName(event.toTeam || event.teamName) === target || normalizeName(event.fromTeam) === target)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

function conferenceTrajectoryPhrase(trajectory) {
  if (trajectory === "improved") return "enters the season clearly stronger";
  if (trajectory === "regressed") return "enters the season noticeably weaker";
  if (trajectory === "strengthened") return "has strengthened";
  if (trajectory === "slipped") return "has slipped";
  return "remains in a similar competitive tier";
}

function buildConferenceCompetition(context) {
  const currentConference = conferenceNameOf(context.team);
  if (!currentConference) return [];
  const userStrength = context.snapshot.average + (context.snapshot.top[0]?.ovr || 0) * 0.16;
  const peers = getAllTeams(context.leagueData)
    .filter((team) => normalizeName(conferenceNameOf(team)) === normalizeName(currentConference))
    .filter((team) => normalizeName(teamNameOf(team)) !== normalizeName(context.canonical))
    .map((team) => {
      const snap = rosterSnapshot(team);
      const previousAverage = previousRotationAverage(context.previousEntry, teamNameOf(team));
      const delta = previousAverage > 0 ? snap.average - previousAverage : 0;
      const progressionRows = teamProgression(context.progressionRows, teamNameOf(team));
      const progressionNet = progressionRows.reduce((sum, row) => sum + safeNumber(row.delta, 0), 0);
      const shift = context.leagueBoard.franchiseShifts.find((row) => normalizeName(row.teamName) === normalizeName(teamNameOf(team)));
      const moves = teamMoveEvidence(context.leagueBoard, teamNameOf(team));
      const strength = snap.average + (snap.top[0]?.ovr || 0) * 0.16;
      let trajectory = "steady";
      if (shift?.severity === "core collapse" || delta <= -1.8 || progressionNet <= -5) trajectory = "regressed";
      else if (delta >= 1.8 || progressionNet >= 5 || (moves[0]?.toTeam && safeNumber(moves[0]?.overall, 0) >= 84)) trajectory = "improved";
      else if (delta <= -0.8 || progressionNet <= -3) trajectory = "slipped";
      else if (delta >= 0.8 || progressionNet >= 3) trajectory = "strengthened";
      return { teamName: teamNameOf(team), snap, previousAverage, delta, progressionNet, shift, moves, strength, trajectory, distance: Math.abs(strength - userStrength) };
    })
    .sort((a, b) => a.distance - b.distance || b.strength - a.strength)
    .slice(0, 4);

  return peers.map((peer) => {
    const move = peer.moves[0];
    let detail = "";
    if (peer.shift?.headline) detail = peer.shift.headline;
    else if (move?.headline) detail = move.headline;
    else if (peer.progressionNet >= 3) detail = `internal development added ${peer.progressionNet} net OVR points across its most notable movers`;
    else if (peer.progressionNet <= -3) detail = `internal regression removed ${Math.abs(peer.progressionNet)} net OVR points across its most notable movers`;
    else detail = `its current rotation remains close to ${possessive(context.canonical)} competitive tier`;
    return {
      teamName: peer.teamName,
      trajectory: peer.trajectory,
      strength: Number(peer.strength.toFixed(1)),
      headline: `${peer.teamName} ${conferenceTrajectoryPhrase(peer.trajectory)}; ${detail}.`,
    };
  });
}

function buildTeamConcerns(context) {
  const items = [];
  const aging = context.snapshot.roster
    .filter((row) => row.age >= 33 && row.ovr >= 80)
    .sort((a, b) => b.ovr - a.ovr || b.age - a.age)
    .slice(0, 2);
  for (const row of aging) {
    items.push(`${row.name} is still ${row.ovr} OVR at age ${row.age}, leaving a meaningful part of the team's ceiling tied to an older veteran staying healthy and productive.`);
  }
  for (const row of context.extensionWatch.slice(0, 2)) items.push(row.headline);
  const extensionNames = new Set(context.extensionWatch.map((row) => normalizeName(row.name)));
  for (const row of context.ownExpiringWatch.filter((item) => !extensionNames.has(normalizeName(item.name))).slice(0, 2)) {
    items.push(`${row.name} (${row.overall} OVR) can reach free agency after this season if no new deal changes the timeline.`);
  }
  return uniqueNames(items, 6);
}

function primaryStoryline(context) {
  const topIncoming = context.activity.significant.find((event) => event.toTeam && normalizeName(event.toTeam) === normalizeName(context.canonical) && event.overall >= 84);
  const topOutgoing = context.activity.outgoingTrades.find((event) => event.overall >= 84);
  const topDeparture = context.turnover?.departures?.find((row) => row.previousOverall >= 84);
  const top = context.snapshot.top[0];
  if (context.previousRow?.champion) return { type:"title_defense", subject:context.canonical, statement:`${context.canonical} enters the season carrying the pressure of a championship defense.` };
  if (topDeparture) {
    const destination = topDeparture.destination ? ` to ${topDeparture.destination}` : "";
    return { type:"roster_reset", subject:topDeparture.name, statement:`The roster now has to absorb ${topDeparture.name}'s departure${destination}, making that loss the defining personnel challenge entering the season.` };
  }
  if (topIncoming) return { type:"roster_reset", subject:topIncoming.playerName, statement:`Adding ${topIncoming.playerName} changes the ceiling of the roster and raises the expectations immediately.` };
  if (topOutgoing) return { type:"roster_reset", subject:topOutgoing.playerName, statement:`Moving ${topOutgoing.playerName} has changed the direction of the roster and put more responsibility on the players who remain.` };
  if (top?.ovr >= 87 && top?.age >= 30) return { type:"star_window", subject:top.name, statement:`The season is tied to maximizing what remains of ${top.name}'s elite window at age ${top.age}.` };
  if (context.snapshot.youngCore.length >= 2) return { type:"development", subject:context.snapshot.youngCore[0]?.name, statement:`The season will show whether ${naturalList(context.snapshot.youngCore.slice(0, 3).map((row) => row.name))} are ready to turn promise into a real competitive core.` };
  return { type:"direction", subject:top?.name || context.canonical, statement:`This season is about turning last year's evidence into a clearer competitive identity.` };
}

function buildTeamSections(context) {
  const transactionItems = context.transactionStories || [];
  const contractItems = [
    ...context.extensionWatch.map((row) => row.headline),
    ...context.ownExpiringWatch
      .filter((row) => !context.extensionWatch.some((ext) => normalizeName(ext.name) === normalizeName(row.name)))
      .map((row) => `${row.name} (${row.overall} OVR) is on an expiring deal and can reach free agency after the season.`),
  ];
  const concernItems = buildTeamConcerns(context);
  const moodItems = context.moodPulse ? [context.moodPulse.summary, ...context.moodPulse.items] : [];

  return [
    { title: "How the roster changed", items: transactionItems.slice(0, 6) },
    { title: "Pressure points", items: concernItems.slice(0, 5) },
    { title: "Contract watch", items: contractItems.slice(0, 6) },
    { title: "Locker room pulse", items: moodItems.slice(0, 5) },
  ].filter((section) => section.items.length);
}

function buildLeagueSections(context) {
  const conferenceItems = context.conferenceCompetition.map((row) => row.headline);
  const majorTrades = context.leagueBoard.trades
    .filter((event) => event.overall >= 78 || event.score >= 72)
    .slice(0, 6)
    .map((event) => event.headline);
  const franchiseShifts = context.leagueBoard.franchiseShifts.slice(0, 5).map((event) => event.headline);
  const majorSignings = context.leagueBoard.signings
    .filter((event) => event.overall >= 78 || event.score >= 70)
    .slice(0, 6)
    .map((event) => event.headline);

  return [
    { title: `${conferenceDisplayName(conferenceNameOf(context.team))} competition`, items: conferenceItems },
    { title: "Major trades", items: majorTrades },
    { title: "Franchise shifts", items: franchiseShifts },
    { title: "Free agency", items: majorSignings },
  ].filter((section) => section.items.length);
}

function buildOutlookSections(context) {
  return [
    { title: "Potential expiring trade targets", items: context.expiringTradeTargets.map((row) => row.headline) },
    { title: `${context.canonical} contract decisions`, items: [
      ...context.extensionWatch.map((row) => row.headline),
      ...context.ownExpiringWatch
        .filter((row) => !context.extensionWatch.some((ext) => normalizeName(ext.name) === normalizeName(row.name)))
        .map((row) => `${row.name} (${row.overall} OVR) is scheduled to reach free agency after this season.`),
    ] },
  ].filter((section) => section.items.length);
}

function buildTeamParagraphs(context) {
  const { canonical, previousRow, previousStats, snapshot, teamProgression, continuity } = context;
  const record = formatRecord(previousRow);
  const finish = formatFinish(previousRow);
  const leader = previousStats[0];
  const roundedLeader = roundedProductionText(leader);
  const leaderLine = leader && roundedLeader
    ? `${leader.name} carried the biggest nightly load, giving them ${roundedLeader}.`
    : "";
  const moodLead = context.moodPulse?.summary || "";
  const first = previousRow
    ? `${choose(`${canonical}|${context.seasonYear}|opening`, [
        `${canonical} does not enter ${seasonLabel(context.seasonYear)} with a blank slate`,
        `The new season starts with last spring still hanging over ${canonical}`,
        `${canonical} arrives at camp with a full year of evidence behind it`,
        `Last season left ${canonical} with a clearer picture of what this group is`,
      ])}. The team finished ${record || "the schedule"} and ${finish}. ${leaderLine} ${moodLead}`.trim()
    : `${canonical} enters the year without a complete prior-season archive, so the current roster has to establish the tone itself. ${moodLead}`.trim();

  const transactionStories = context.transactionStories || [];
  const second = transactionStories.length
    ? transactionStories.slice(0, 3).join(" ")
    : "The core came through the offseason mostly intact, so this season will lean more heavily on internal growth than on a dramatic personnel reset.";

  const top = snapshot.top[0];
  const secondStar = snapshot.top[1];
  const aging = snapshot.roster.filter((row) => row.ovr >= 82 && row.age >= 33).sort((a, b) => b.ovr - a.ovr).slice(0, 2);
  const identity = [];
  if (top) identity.push(`${top.name} remains the central piece at ${top.ovr} OVR`);
  if (secondStar) identity.push(`${secondStar.name} gives the roster another major pillar at ${secondStar.ovr} OVR`);
  if (aging.length) identity.push(`${naturalList(aging.map((row) => `${row.name}, now ${row.age}`))} makes age and durability part of the competitive equation`);
  const third = `${identity.length ? `${naturalList(identity)}.` : "The rotation still needs a clear hierarchy."}${teamProgression.length ? ` Internally, ${teamProgression.slice(0, 3).map((row) => `${row.name} ${row.delta > 0 ? "moved forward" : "gave back ground"}`).join(", ")}, changing the amount of responsibility the coaching staff can reasonably place on the younger pieces.` : ""}`;

  const concernItems = buildTeamConcerns(context).slice(0, 3);
  const continuityLead = continuity?.evidence ? `The thread from last season has not disappeared: ${continuity.evidence}.` : "";
  const fourthFallback = transactionStories[3] || context.primaryStoryline.statement;
  const fourth = `${continuityLead} ${concernItems.length
    ? `The pressure entering camp is less abstract now. ${concernItems.join(" ")}`
    : fourthFallback}`.trim();

  return [first, second, third, fourth].filter(Boolean);
}

function buildLeagueParagraphs(context) {
  const { canonical, leagueBoard, previousEntry } = context;
  const champ = text(previousEntry?.champion);
  const firstEvents = leagueBoard.events.filter((event) => ["champion", "award", "team_season"].includes(event.type)).slice(0, 4);
  const first = firstEvents.length
    ? firstEvents.map((event) => `${event.headline}.`).join(" ")
    : champ
      ? `${champ} begins the year carrying the league's championship target.`
      : "The league opens without one overwhelming archived headline, which puts more weight on the changes teams made after the season ended.";

  const movementLeads = [...leagueBoard.trades.slice(0, 3), ...leagueBoard.signings.slice(0, 3), ...leagueBoard.franchiseShifts.slice(0, 2)]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((event) => event.headline);
  const second = movementLeads.length
    ? `${choose(`${canonical}|${context.seasonYear}|league-moved`, [
        "The summer changed the shape of the league in several places",
        "The transaction wire mattered this offseason",
        "Several front offices chose movement over continuity",
      ])}. ${movementLeads.join(". ")}. Those decisions will show up in rotations and playoff matchups long before they show up in a retrospective grade.`
    : "The offseason produced no saved blockbuster large enough to redefine the landscape, so continuity will matter more than transaction shock at the start of the year.";

  const conference = conferenceDisplayName(conferenceNameOf(context.team));
  const rivals = context.conferenceCompetition.slice(0, 3);
  const rivalSentences = rivals.map((row) => row.headline.replace(/\.$/, ""));
  const third = rivals.length
    ? `${possessive(canonical)} real race begins inside the ${conference}. ${rivalSentences.join(". ")}. That is the neighborhood that will decide seeding, matchup pressure and how aggressive the front office needs to become before the deadline.`
    : `${possessive(canonical)} first measure is the ${conference}. The playoff race there will tell the front office far more than a generic league-wide roster ranking ever could.`;
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
  const { canonical, snapshot, previousRow, activity, futureFirsts, expiringTradeTargets, extensionWatch, ownExpiringWatch } = context;
  const top = snapshot.top[0];
  const core = snapshot.top.slice(0, 3).map((row) => `${row.name} (${row.ovr} OVR${row.age ? `, age ${row.age}` : ""})`);
  const first = `${canonical} opens ${seasonLabel(context.seasonYear)} around ${naturalList(core) || "an unsettled core"}. ${previousRow ? `That group is coming out of a ${formatRecord(previousRow)} season that ${formatFinish(previousRow)}.` : "The prior-season archive is incomplete, so the current roster has to establish the standard itself."}`;

  const pressureBits = [];
  const aging = snapshot.roster.filter((row) => row.ovr >= 82 && row.age >= 33).sort((a, b) => b.ovr - a.ovr).slice(0, 2);
  if (aging.length) pressureBits.push(`${naturalList(aging.map((row) => `${row.name} at age ${row.age}`))} keeps part of the team's ceiling tied to an older veteran timeline`);
  if (extensionWatch.length) pressureBits.push(`${extensionWatch.length} meaningful extension decision${extensionWatch.length === 1 ? " is" : "s are"} already approaching`);
  const nonExtensionExpirings = ownExpiringWatch.filter((row) => !extensionWatch.some((ext) => normalizeName(ext.name) === normalizeName(row.name)));
  if (nonExtensionExpirings.length) pressureBits.push(`${naturalList(nonExtensionExpirings.slice(0, 2).map((row) => row.name))} can reach free agency after the season`);
  if (context.moodPulse?.average < 60) pressureBits.push("the locker room is entering the year with more tension than comfort");
  const second = `${pressureBits.length ? `The front office is managing several live pressures: ${pressureBits.join("; ")}.` : "The front office enters the year without one obvious crisis hanging over the roster."} The team controls ${futureFirsts} listed first-round pick${futureFirsts === 1 ? "" : "s"} over the next four drafts${expiringTradeTargets.length ? `, while ${expiringTradeTargets.length} outside players on expiring deals currently grade as realistic market fits` : ""}.`;

  const starMove = activity.significant.find((event) => event.overall >= 84);
  const evidence = starMove ? `${starMove.headline}. ` : "";
  const third = `${evidence}${context.primaryStoryline.statement} The season should be judged by whether the roster's decisions strengthen that direction rather than simply preserve the status quo.`.trim();
  return [first, second, third];
}

export function buildSeasonBriefingData(leagueData, teamName, explicitYear = null, options = {}) {
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
  const extensionWatch = buildExtensionWatch(team, leagueData);
  const ownExpiringWatch = buildOwnExpiringWatch(team, leagueData);
  const expiringTradeTargets = buildExpiringTradeTargets(leagueData, canonical, snapshot);
  const moodPulse = buildMoodPulse(options?.moodData || null, previousRow, canonical);

  const context = {
    leagueData, seasonYear, canonical, team, previousEntry, previousRow, snapshot,
    progressionRows, progression, teamProgression:teamProgressionRows,
    leagueBoard, activity, previousStats, turnover, draft, firstRoundPicks, futureFirsts,
    recentRookieRows, extensionWatch, ownExpiringWatch, expiringTradeTargets, moodPulse,
  };
  context.transactionStories = buildTeamTransactionStories(context);
  context.conferenceCompetition = buildConferenceCompetition(context);
  const prior = previousStoredSnapshot(leagueData, canonical, seasonYear);
  const story = primaryStoryline(context);
  context.primaryStoryline = story;
  context.continuity = continuityAssessment(prior, context);

  const dossier = {
    version: 5,
    generatedFrom: "cinematic_transaction_timeline_market_contract_mood_intel",
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
    transactionStories: context.transactionStories.slice(0, 6),
    majorTrades: leagueBoard.trades.slice(0, 6).map((event) => ({ playerName:event.playerName, fromTeam:event.fromTeam, toTeam:event.toTeam, overall:event.overall || 0, phase:event.phase || "unknown", headline:event.headline })),
    majorSignings: leagueBoard.signings.slice(0, 6).map((event) => ({ playerName:event.playerName, toTeam:event.toTeam, overall:event.overall || 0, years:event.years || 0, aav:event.aav || 0, headline:event.headline })),
    franchiseShifts: leagueBoard.franchiseShifts.slice(0, 5).map((event) => ({ teamName:event.teamName, severity:event.severity, headline:event.headline })),
    extensionWatch: extensionWatch.slice(0, 6).map((row) => ({ name:row.name, overall:row.overall, yearsLeft:row.yearsLeft, extensionType:row.extensionType, headline:row.headline })),
    ownExpiringWatch: ownExpiringWatch.slice(0, 6).map((row) => ({ name:row.name, overall:row.overall, age:row.age, yearsLeft:row.yearsLeft, headline:row.headline })),
    moodPulse: moodPulse ? { average:moodPulse.average, summary:moodPulse.summary, unsettled:moodPulse.unsettled } : null,
    conferenceCompetition: context.conferenceCompetition.slice(0, 4),
    expiringTradeTargets: expiringTradeTargets.slice(0, 6).map((row) => ({ name:row.name, teamName:row.teamName, overall:row.overall, age:row.age, salary:row.salary, headline:row.headline })),
    leagueHeadlines: leagueBoard.events.slice(0, 12).map((event) => ({ type:event.type, headline:event.headline, score:event.score })),
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
    source: "event_dossier_v5",
    dossier,
    tabs: {
      team: {
        eyebrow:"TEAM BRIEFING",
        title:canonical,
        paragraphs:buildTeamParagraphs(context),
        sections:buildTeamSections(context),
      },
      league: {
        eyebrow:"LEAGUE LANDSCAPE",
        title:"The league has moved",
        paragraphs:buildLeagueParagraphs(context),
        sections:buildLeagueSections(context),
        progression,
      },
      prospects: {
        eyebrow:"PROSPECTS & PICKS",
        title:`The ${draft.draftYear} board`,
        paragraphs:buildProspectParagraphs(context),
        prospects:prospectRows,
        classCount:draft.classCount,
        draftYear:draft.draftYear,
      },
      outlook: {
        eyebrow:"SEASON OUTLOOK",
        title:"The season ahead",
        paragraphs:buildOutlookParagraphs(context),
        sections:buildOutlookSections(context),
      },
    },
  };
}

export function getSeasonBriefingDiagnostics(leagueData, teamName, explicitYear = null, options = {}) {
  const briefing = buildSeasonBriefingData(leagueData, teamName, explicitYear, options);
  return briefing ? {
    key: briefing.key,
    source: briefing.source,
    teamName: briefing.teamName,
    seasonYear: briefing.seasonYear,
    dossier: briefing.dossier || null,
    paragraphCounts: Object.fromEntries(Object.entries(briefing.tabs || {}).map(([key, tab]) => [key, tab?.paragraphs?.length || 0])),
  } : null;
}
