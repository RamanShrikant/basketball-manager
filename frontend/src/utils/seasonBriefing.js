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

export const SEASON_BRIEFING_CONTENT_VERSION = 11;
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

const TEAM_NICKNAME_PATTERN = /(Trail Blazers|76ers|Hawks|Celtics|Nets|Hornets|Bulls|Cavaliers|Mavericks|Nuggets|Pistons|Warriors|Rockets|Pacers|Clippers|Lakers|Grizzlies|Heat|Bucks|Timberwolves|Pelicans|Knicks|Thunder|Magic|Suns|Kings|Spurs|Raptors|Jazz|Wizards)$/i;

function teamNickname(teamName) {
  const match = text(teamName).match(TEAM_NICKNAME_PATTERN);
  return match?.[1] || text(teamName);
}

function teamMarketName(teamName) {
  const source = text(teamName);
  const nickname = teamNickname(source);
  if (!source || !nickname || normalizeName(source) === normalizeName(nickname)) return source;
  return source.replace(new RegExp(`\\s+${nickname.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "i"), "").trim() || source;
}

function teamReference(teamName) {
  const nickname = teamNickname(teamName);
  return nickname ? `the ${nickname}` : text(teamName);
}

function draftPickOwnerName(pick = {}) {
  return text(
    pick?.ownerTeam ||
    pick?.owner ||
    pick?.currentOwner ||
    pick?.currentOwnerTeamName ||
    pick?.ownerTeamName ||
    pick?.owningTeam ||
    pick?.teamName ||
    pick?.team
  );
}

function draftPickOriginalTeamName(pick = {}) {
  return text(
    pick?.originalTeam ||
    pick?.originalTeamName ||
    pick?.original ||
    pick?.originalPickTeamName ||
    pick?.naturalLotteryTeamName ||
    pick?.fromTeam ||
    pick?.sourceTeam ||
    pick?.teamName ||
    pick?.team
  );
}

function tradeAssetType(asset = {}) {
  const raw = normalizeName(asset?.type || asset?.assetType || "");
  if (raw.includes("pick") || raw.includes("swap") || asset?.pickId || asset?.year) return "pick";
  return "player";
}

function normalizeTradeAsset(asset = {}) {
  const type = tradeAssetType(asset);
  if (type === "pick") {
    const rawType = normalizeName(asset?.assetType || asset?.pickType || asset?.type || "pick");
    const isSwap = rawType.includes("swap") || Boolean(asset?.swapWithTeam || asset?.swapTeam || asset?.swapGroup);
    return {
      type: "pick",
      assetType: isSwap ? "swap" : "pick",
      pickId: text(asset?.pickId || asset?.id),
      label: text(asset?.displayLabel || asset?.label),
      year: safeNumber(asset?.year ?? asset?.season ?? asset?.seasonYear, 0),
      round: safeNumber(asset?.round ?? asset?.rnd, 0),
      originalTeam: draftPickOriginalTeamName(asset),
      protection: text(asset?.protection || asset?.displayProtection || asset?.protections),
      fromTeam: text(asset?.teamName || asset?.fromTeam),
      source: asset,
    };
  }
  return {
    type: "player",
    playerName: text(asset?.playerName || asset?.name || asset?.player),
    playerId: text(asset?.playerId || asset?.id),
    overall: safeNumber(asset?.overall ?? asset?.ovr ?? asset?.rating, 0),
    potential: safeNumber(asset?.potential ?? asset?.pot, 0),
    age: safeNumber(asset?.age, 0),
    salary: safeNumber(asset?.salary ?? asset?.capHit ?? asset?.aav, 0),
    pos: text(asset?.pos || asset?.position),
    fromTeam: text(asset?.fromTeam || asset?.from),
    toTeam: text(asset?.toTeam || asset?.to),
    source: asset,
  };
}

function normalizeTradeAssets(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(normalizeTradeAsset).filter((asset) => (
    asset.type === "player" ? asset.playerName : (asset.pickId || asset.year || asset.label)
  ));
}

function fallbackTradePackages(row = {}) {
  const userTeamName = text(row?.userTeamName || row?.fromTeamName);
  const cpuTeamName = text(row?.cpuTeamName || row?.toTeamName);
  const userSent = normalizeTradeAssets(row?.userSentAssets || []);
  const cpuSent = normalizeTradeAssets(row?.cpuSentAssets || []);
  if (userTeamName && cpuTeamName && (userSent.length || cpuSent.length)) {
    return [
      { teamName: userTeamName, sent: userSent, received: cpuSent },
      { teamName: cpuTeamName, sent: cpuSent, received: userSent },
    ];
  }

  const movedPlayers = getTradeMoves(row);
  const teams = uniqueNames(movedPlayers.flatMap((move) => [move.fromTeam, move.toTeam]), 8);
  if (teams.length < 2) return [];
  return teams.map((teamName) => ({
    teamName,
    sent: movedPlayers
      .filter((move) => normalizeName(move.fromTeam) === normalizeName(teamName))
      .map((move) => normalizeTradeAsset({ type:"player", playerName:move.name, fromTeam:move.fromTeam, toTeam:move.toTeam })),
    received: movedPlayers
      .filter((move) => normalizeName(move.toTeam) === normalizeName(teamName))
      .map((move) => normalizeTradeAsset({ type:"player", playerName:move.name, fromTeam:move.fromTeam, toTeam:move.toTeam })),
  }));
}

function detailedTradePackages(row = {}) {
  if (Array.isArray(row?.teamPackages) && row.teamPackages.length >= 2) {
    return row.teamPackages.map((side) => ({
      teamName: text(side?.teamName),
      sent: normalizeTradeAssets(side?.sent || []),
      received: normalizeTradeAssets(side?.received || []),
      reason: text(side?.reason),
    })).filter((side) => side.teamName);
  }
  return fallbackTradePackages(row);
}

function tradeSortValue(row = {}, fallback = 0) {
  const raw = text(row?.currentDate || row?.date || row?.completedAt);
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  return safeNumber(row?.dayIndex ?? row?.day, fallback);
}

function assetImportance(asset = {}) {
  if (asset.type === "player") {
    const ovr = safeNumber(asset.overall, 0);
    return ovr >= 90 ? 115 : ovr >= 86 ? 104 : ovr >= 82 ? 92 : ovr >= 78 ? 78 : ovr >= 74 ? 64 : 48;
  }
  if (asset.assetType === "swap") return 70;
  if (Number(asset.round) === 1) return 82;
  if (Number(asset.round) === 2) return 38;
  return 32;
}

function describePickAsset(asset = {}, { includeProtection = true } = {}) {
  const year = safeNumber(asset?.year, 0);
  const original = text(asset?.originalTeam);
  const round = Number(asset?.round || 0);
  const roundLabel = round === 1 ? "first-round pick" : round === 2 ? "second-round pick" : "draft pick";
  const protection = includeProtection && text(asset?.protection) && !/unprotected/i.test(text(asset.protection))
    ? `${text(asset.protection)} `
    : includeProtection && /unprotected/i.test(text(asset?.protection)) ? "unprotected " : "";
  if (asset?.assetType === "swap") return `${year || "future"} first-round swap${original ? ` involving ${original}` : ""}`;
  return `${protection}${year || "future"} ${original ? `${original} ` : ""}${roundLabel}`.replace(/\s+/g, " ").trim();
}

function describeTradeAssets(assets = [], limit = 4) {
  const rows = (assets || []).filter(Boolean);
  if (!rows.length) return "";
  const labels = rows.slice(0, limit).map((asset) => asset.type === "player" ? asset.playerName : describePickAsset(asset));
  if (rows.length > limit) labels.push(`${rows.length - limit} more asset${rows.length - limit === 1 ? "" : "s"}`);
  return naturalList(labels);
}

function buildTeamTradeTimeline(leagueData, teamName, seasonYear, { lookback = 1 } = {}) {
  const target = normalizeName(teamName);
  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  const liveIndex = playerIndex(leagueData);
  const previousEntry = getPreviousSeasonEntry(leagueData, seasonYear);
  const archivedIndex = archivedPlayerIndex(previousEntry);
  const enrichAsset = (asset) => {
    if (asset?.type !== "player" || !asset?.playerName) return asset;
    const live = liveIndex.get(normalizeName(asset.playerName));
    const archived = archivedIndex.get(normalizeName(asset.playerName));
    return {
      ...asset,
      overall: Math.max(safeNumber(asset.overall, 0), safeNumber(live?.overall, 0), safeNumber(archived?.overall, 0)),
      age: safeNumber(asset.age, 0) || safeNumber(live?.age, 0) || safeNumber(archived?.age, 0),
    };
  };
  const out = [];

  history.forEach((row, rowIndex) => {
    const rowYear = safeNumber(row?.seasonYear, 0);
    if (rowYear && rowYear < Number(seasonYear) - lookback) return;
    if (rowYear && rowYear > Number(seasonYear)) return;
    const packages = detailedTradePackages(row);
    const side = packages.find((item) => normalizeName(item.teamName) === target);
    if (!side) return;
    const sent = side.sent.map(enrichAsset);
    const received = side.received.map(enrichAsset);
    const partners = packages.filter((item) => normalizeName(item.teamName) !== target).map((item) => item.teamName).filter(Boolean);
    const partner = partners.length === 1 ? partners[0] : naturalList(partners);
    const score = Math.max(0, ...[...sent, ...received].map(assetImportance));
    out.push({
      id: text(row?.id) || `trade_${rowIndex}`,
      rowIndex,
      row,
      seasonYear: rowYear,
      date: text(row?.currentDate || row?.date || row?.completedAt),
      sortValue: tradeSortValue(row, rowIndex),
      phase: tradePhaseFromRecord(row),
      teamName,
      partnerTeam: partner,
      teamContextAtTrade: row?.teamContextAtTrade && typeof row.teamContextAtTrade === "object" ? row.teamContextAtTrade : null,
      sent,
      received,
      score,
    });
  });

  return out.sort((a, b) => a.sortValue - b.sortValue || a.rowIndex - b.rowIndex);
}

function allTeamTradeTimeline(leagueData, teamName, seasonYear, lookback = 6) {
  return buildTeamTradeTimeline(leagueData, teamName, seasonYear, { lookback });
}

function normalizeStintRow(row = {}) {
  const stats = row?.stats && typeof row.stats === "object" ? row.stats : {};
  return {
    name: playerNameOf(row),
    teamName: text(row?.teamName || row?.team),
    games: safeNumber(row?.games ?? row?.gp ?? row?.GP ?? stats?.GP, 0),
    ppg: safeNumber(row?.ppg ?? stats?.PTS, NaN),
    rpg: safeNumber(row?.rpg ?? stats?.REB, NaN),
    apg: safeNumber(row?.apg ?? stats?.AST, NaN),
    spg: safeNumber(row?.spg ?? stats?.STL, NaN),
    bpg: safeNumber(row?.bpg ?? stats?.BLK, NaN),
  };
}

function currentOrHistoricalPlayer(leagueData, playerName) {
  const target = normalizeName(playerName);
  const current = playerIndex(leagueData).get(target);
  if (current) return current;
  const retired = (Array.isArray(leagueData?.retiredPlayersHistory) ? leagueData.retiredPlayersHistory : [])
    .find((row) => normalizeName(playerNameOf(row)) === target);
  return retired || null;
}

function playerSeasonStints(leagueData, previousEntry, playerName) {
  const target = normalizeName(playerName);
  if (!target) return [];
  const archived = previousEntry?.statsArchive?.regular || {};
  const explicitStints = (Array.isArray(archived?.stintRows) ? archived.stintRows : [])
    .filter((row) => normalizeName(playerNameOf(row)) === target)
    .map(normalizeStintRow)
    .filter((row) => row.teamName && row.games > 0);
  if (explicitStints.length) return explicitStints;

  const player = currentOrHistoricalPlayer(leagueData, playerName);
  const displayYear = safeNumber(previousEntry?.seasonYear, 0) + 1;
  const historyRows = (Array.isArray(player?.history?.seasons) ? player.history.seasons : [])
    .filter((row) => safeNumber(row?.seasonYear, 0) === displayYear)
    .map(normalizeStintRow)
    .filter((row) => row.teamName && row.games > 0);
  if (historyRows.length) return historyRows;

  return archivedPlayerRows(previousEntry)
    .filter((row) => normalizeName(playerNameOf(row)) === target)
    .map(normalizeStintRow)
    .filter((row) => row.teamName && row.games > 0);
}

function playerStintOnTeam(leagueData, previousEntry, playerName, teamName) {
  const target = normalizeName(teamName);
  return playerSeasonStints(leagueData, previousEntry, playerName)
    .find((row) => normalizeName(row.teamName) === target) || null;
}

function formatHumanProduction(stint = {}, { includeGames = false } = {}) {
  const parts = [];
  if (Number.isFinite(stint?.ppg)) parts.push(`${Math.round(stint.ppg)} point${Math.round(stint.ppg) === 1 ? "" : "s"}`);
  if (Number.isFinite(stint?.rpg) && stint.rpg >= 2) parts.push(`${Math.round(stint.rpg)} rebound${Math.round(stint.rpg) === 1 ? "" : "s"}`);
  if (Number.isFinite(stint?.apg) && stint.apg >= 2) parts.push(`${Math.round(stint.apg)} assist${Math.round(stint.apg) === 1 ? "" : "s"}`);
  const production = parts.length ? naturalList(parts) : "";
  if (includeGames && stint?.games) return `${stint.games} games${production ? ` at about ${production} per game` : ""}`;
  return production ? `about ${production} per game` : "";
}

function pickKey(asset = {}) {
  const id = text(asset?.pickId || asset?.id || asset?.draftPickAssetId);
  if (id) return `id:${id}`;
  return [
    safeNumber(asset?.year ?? asset?.draftYear, 0),
    safeNumber(asset?.round, 0),
    normalizeName(asset?.originalTeam || asset?.originalTeamName),
  ].join("|");
}

function samePickAsset(a = {}, b = {}) {
  const aId = text(a?.pickId || a?.id || a?.draftPickAssetId);
  const bId = text(b?.pickId || b?.id || b?.draftPickAssetId);
  if (aId && bId) return aId === bId;
  return safeNumber(a?.year ?? a?.draftYear, 0) === safeNumber(b?.year ?? b?.draftYear, 0) &&
    safeNumber(a?.round, 0) === safeNumber(b?.round, 0) &&
    normalizeName(a?.originalTeam || a?.originalTeamName) === normalizeName(b?.originalTeam || b?.originalTeamName);
}

function buildTradeAssetLedger({ leagueData, teamName, seasonYear, previousEntry, timeline }) {
  const currentNames = new Set((findTeam(leagueData, teamName) ? getRoster(findTeam(leagueData, teamName)) : []).map((player) => normalizeName(playerNameOf(player))));
  const receivedBefore = new Map();
  const laterSentNames = new Set();
  const bridges = [];
  const rootOutgoingPlayers = [];
  const allIncomingPlayers = [];
  const picksIn = [];
  const picksOut = [];
  const seenRoot = new Set();

  for (const event of timeline) {
    for (const asset of event.received) {
      if (asset.type === "pick") {
        picksIn.push({ ...asset, eventId:event.id, partnerTeam:event.partnerTeam, date:event.date, event });
        continue;
      }
      allIncomingPlayers.push({ ...asset, eventId:event.id, partnerTeam:asset.fromTeam || event.partnerTeam, date:event.date, event });
      const key = normalizeName(asset.playerName);
      if (key) receivedBefore.set(key, { asset:{ ...asset, partnerTeam:asset.fromTeam || event.partnerTeam }, event });
    }

    for (const asset of event.sent) {
      if (asset.type === "pick") {
        picksOut.push({ ...asset, eventId:event.id, partnerTeam:event.partnerTeam, date:event.date, event });
        continue;
      }
      const key = normalizeName(asset.playerName);
      if (!key) continue;
      const received = receivedBefore.get(key);
      if (received) {
        laterSentNames.add(key);
        const stint = playerStintOnTeam(leagueData, previousEntry, asset.playerName, teamName);
        const days = received.event.sortValue && event.sortValue && event.sortValue > received.event.sortValue
          ? Math.max(0, Math.round((event.sortValue - received.event.sortValue) / 86400000))
          : null;
        bridges.push({
          playerName: asset.playerName,
          overall: Math.max(asset.overall || 0, received.asset.overall || 0),
          acquiredFrom: received.asset.partnerTeam || received.event.partnerTeam,
          acquiredDate: received.event.date,
          movedTo: asset.toTeam || event.partnerTeam,
          movedDate: event.date,
          games: stint?.games || 0,
          stint,
          days,
          receivedWhenMoved: event.received,
          acquiredEvent: received.event,
          movedEvent: event,
        });
      } else if (!seenRoot.has(key)) {
        seenRoot.add(key);
        rootOutgoingPlayers.push({ ...asset, eventId:event.id, partnerTeam:asset.toTeam || event.partnerTeam, date:event.date, event });
      }
    }
  }

  const retainedIncomingPlayers = allIncomingPlayers
    .filter((asset) => !laterSentNames.has(normalizeName(asset.playerName)))
    .filter((asset) => !asset.playerName || currentNames.has(normalizeName(asset.playerName)))
    .sort((a, b) => b.overall - a.overall);

  rootOutgoingPlayers.sort((a, b) => b.overall - a.overall);
  bridges.sort((a, b) => b.overall - a.overall);

  const firstsIn = picksIn.filter((pick) => Number(pick.round) === 1 && pick.assetType !== "swap").length;
  const firstsOut = picksOut.filter((pick) => Number(pick.round) === 1 && pick.assetType !== "swap").length;
  const secondsIn = picksIn.filter((pick) => Number(pick.round) === 2).length;
  const secondsOut = picksOut.filter((pick) => Number(pick.round) === 2).length;
  const swapsIn = picksIn.filter((pick) => pick.assetType === "swap").length;
  const swapsOut = picksOut.filter((pick) => pick.assetType === "swap").length;
  const salaryOut = rootOutgoingPlayers.reduce((sum, row) => sum + safeNumber(row.salary, 0), 0);
  const salaryIn = retainedIncomingPlayers.reduce((sum, row) => sum + safeNumber(row.salary, 0), 0);

  return {
    timeline,
    rootOutgoingPlayers,
    retainedIncomingPlayers,
    bridges,
    picksIn,
    picksOut,
    firstsIn,
    firstsOut,
    secondsIn,
    secondsOut,
    swapsIn,
    swapsOut,
    netFirsts: firstsIn - firstsOut,
    netSeconds: secondsIn - secondsOut,
    netSwaps: swapsIn - swapsOut,
    salaryOut,
    salaryIn,
    salaryDelta: salaryIn - salaryOut,
  };
}

function tradeCheckpointForTeam(event = {}, teamName = "") {
  const contexts = event?.teamContextAtTrade || event?.row?.teamContextAtTrade || {};
  const target = normalizeName(teamName);
  const key = Object.keys(contexts || {}).find((name) => normalizeName(name) === target);
  if (!key) return null;
  const row = contexts[key] || {};
  const wins = safeNumber(row?.wins, 0);
  const losses = safeNumber(row?.losses, 0);
  return wins + losses > 0 ? { wins, losses, record:`${wins}-${losses}`, phase:text(row?.phase) } : null;
}

function previousTeamOutcome(previousEntry, teamName) {
  const row = previousTeamRow(previousEntry, teamName);
  if (!row) return null;
  return {
    teamName,
    record: formatRecord(row),
    finish: formatFinish(row),
    wins: safeNumber(row?.wins ?? row?.w, 0),
    losses: safeNumber(row?.losses ?? row?.l, 0),
    row,
  };
}

function playerAwardsInSeason(leagueData, playerName, seasonYear) {
  const target = normalizeName(playerName);
  const labels = [];
  for (const rows of Object.values(leagueData?.leagueHistory?.awards || {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (Number(row?.seasonYear) !== Number(seasonYear)) continue;
      if (normalizeName(playerNameOf(row)) !== target) continue;
      labels.push(text(row?.label || row?.shortLabel || row?.awardKey));
    }
  }

  // Player-card history keeps a richer set of accolades than leagueHistory,
  // including All-NBA, All-Defense, All-Star, championships, and Finals MVP.
  const player = currentOrHistoricalPlayer(leagueData, playerName);
  for (const row of Array.isArray(player?.history?.accolades) ? player.history.accolades : []) {
    if (Number(row?.seasonYear) !== Number(seasonYear)) continue;
    labels.push(text(row?.label || row?.details || row?.type));
  }

  return uniqueNames(labels.filter(Boolean), 5);
}

function buildTradePartnerAftermath(context) {
  const timeline = context.historicalTradeTimeline || context.recentTradeTimeline || [];
  const receivedBefore = new Set();
  const candidates = [];
  const seenPlayers = new Set();

  for (const event of timeline) {
    for (const asset of event.received || []) {
      if (asset.type === "player" && asset.playerName) receivedBefore.add(normalizeName(asset.playerName));
    }
    for (const asset of event.sent || []) {
      if (asset.type !== "player" || !asset.playerName) continue;
      const key = normalizeName(asset.playerName);
      // A player who arrived earlier and was later flipped is handled as a bridge
      // in the main trade-chain story. This section follows true outgoing assets.
      if (!key || receivedBefore.has(key) || seenPlayers.has(key)) continue;
      const live = currentOrHistoricalPlayer(context.leagueData, asset.playerName);
      const overall = Math.max(safeNumber(asset.overall, 0), playerOverall(live));
      if (overall < 80) continue;
      seenPlayers.add(key);
      candidates.push({ ...asset, overall, event, destination:asset.toTeam || event.partnerTeam });
    }
  }

  const items = [];
  for (const asset of candidates) {
    const destination = asset.destination || asset.event?.partnerTeam || "";
    if (!destination) continue;

    const allStints = playerSeasonStints(context.leagueData, context.previousEntry, asset.playerName);
    const destinationStint = allStints.find((row) => normalizeName(row.teamName) === normalizeName(destination)) || null;
    const current = currentOrHistoricalPlayer(context.leagueData, asset.playerName);
    const currentTeam = text(current?.teamName || current?.team);
    const currentStint = currentTeam
      ? allStints.find((row) => normalizeName(row.teamName) === normalizeName(currentTeam)) || null
      : null;
    const outsideStints = allStints.filter((row) => normalizeName(row.teamName) !== normalizeName(context.canonical));
    const relevantStint = destinationStint || (currentStint && normalizeName(currentStint.teamName) !== normalizeName(context.canonical) ? currentStint : null) || outsideStints.slice().sort((a, b) => b.games - a.games)[0] || null;
    const relevantTeam = relevantStint?.teamName || (currentTeam && normalizeName(currentTeam) !== "free agency" ? currentTeam : destination);
    const outcome = relevantStint ? previousTeamOutcome(context.previousEntry, relevantTeam) : null;
    const destinationCheckpoint = tradeCheckpointForTeam(asset.event, destination);
    const awards = playerAwardsInSeason(context.leagueData, asset.playerName, context.seasonYear);
    const tradeYear = safeNumber(asset.event?.seasonYear, 0);
    const seasonsAgo = tradeYear ? Math.max(0, context.seasonYear - tradeYear) : 0;

    const intro = seasonsAgo >= 2
      ? `${asset.playerName}, whom ${teamMarketName(context.canonical)} traded to ${teamMarketName(destination)} in ${tradeYear}`
      : `${asset.playerName}, who ${teamMarketName(context.canonical)} sent to ${teamMarketName(destination)}`;
    const sentences = [];

    if (relevantStint?.games) {
      const production = formatHumanProduction(relevantStint);
      const locationNote = normalizeName(relevantTeam) === normalizeName(destination)
        ? `for ${teamMarketName(destination)}`
        : `for ${teamMarketName(relevantTeam)}`;
      sentences.push(`${intro}, played ${relevantStint.games} games ${locationNote}${production ? ` and averaged ${production}` : ""} last season`);
    } else if (currentTeam && normalizeName(currentTeam) !== "free agency") {
      sentences.push(`${intro}, is now with ${currentTeam}`);
    } else {
      sentences.push(`${intro}, is no longer on ${teamReference(context.canonical)} roster`);
    }

    if (outcome?.record) {
      if (destinationCheckpoint && normalizeName(relevantTeam) === normalizeName(destination)) {
        sentences.push(`${teamMarketName(relevantTeam)} was ${destinationCheckpoint.record} when the trade happened, then finished ${outcome.record} and ${outcome.finish}`);
      } else {
        sentences.push(`${teamMarketName(relevantTeam)} finished ${outcome.record} and ${outcome.finish}`);
      }
    }
    if (awards.length) sentences.push(`${asset.playerName} also earned ${naturalList(awards)}`);

    const headline = `${sentences.join(". ")}.`;
    items.push({
      playerName: asset.playerName,
      destination,
      overall: asset.overall,
      tradeYear,
      seasonsAgo,
      stint: relevantStint,
      outcome,
      checkpoint: destinationCheckpoint,
      awards,
      currentTeam,
      headline,
      score: asset.overall + (outcome?.wins || 0) * 0.2 + (awards.length ? 8 : 0) - seasonsAgo * 2,
    });
  }

  return items.sort((a, b) => b.score - a.score).slice(0, 4);
}


function compactDraftHistoryFromState(state = {}) {
  const draft = state?.draft && typeof state.draft === "object" ? state.draft : state;
  if (!draft?.completed || !Array.isArray(draft?.draftedPicks) || !draft.draftedPicks.length) return null;
  const draftYear = safeNumber(draft?.seasonYear, 0);
  if (!draftYear) return null;
  const order = Array.isArray(draft?.draftOrder) ? draft.draftOrder : [];
  const orderByPick = new Map(order.map((row, index) => [safeNumber(row?.pick ?? row?.pickNumber, index + 1), row]));
  return {
    version: 0,
    draftYear,
    completedAt: null,
    picks: draft.draftedPicks.map((pick, index) => {
      const pickNumber = safeNumber(pick?.pick, index + 1);
      const orderRow = orderByPick.get(pickNumber) || {};
      return {
        pick: pickNumber,
        round: safeNumber(pick?.round || orderRow?.round, pickNumber <= 30 ? 1 : 2),
        pickInRound: safeNumber(pick?.pickInRound || orderRow?.pickInRound, ((pickNumber - 1) % 30) + 1),
        currentOwnerTeamName: text(pick?.teamName || orderRow?.currentOwnerTeamName || orderRow?.teamName),
        teamName: text(pick?.teamName || orderRow?.currentOwnerTeamName || orderRow?.teamName),
        originalTeamName: text(pick?.originalTeamName || orderRow?.originalTeamName || orderRow?.originalPickTeamName),
        playerId: text(pick?.playerId || pick?.id),
        playerName: text(pick?.playerName || pick?.name),
        pos: text(pick?.pos || pick?.position),
        overall: safeNumber(pick?.overall ?? pick?.ovr, 0),
        potential: safeNumber(pick?.potential ?? pick?.pot, 0),
        age: safeNumber(pick?.age, 0),
        draftPickAssetId: text(orderRow?.draftPickAssetId || orderRow?.swapAssetId),
        draftPickProtection: text(orderRow?.draftPickProtection || orderRow?.swapProtectionLabel),
      };
    }),
  };
}

function getDraftHistory(leagueData) {
  const rows = Array.isArray(leagueData?.draftHistory) ? [...leagueData.draftHistory] : [];
  const live = compactDraftHistoryFromState(leagueData?.draftState || {});
  if (live && !rows.some((row) => Number(row?.draftYear) === Number(live.draftYear))) rows.push(live);
  return rows.sort((a, b) => safeNumber(a?.draftYear, 0) - safeNumber(b?.draftYear, 0));
}

function findDraftOutcomeForPick(leagueData, pickAsset = {}) {
  const history = getDraftHistory(leagueData);
  const year = safeNumber(pickAsset?.year, 0);
  const round = safeNumber(pickAsset?.round, 0);
  const original = normalizeName(pickAsset?.originalTeam);
  const id = text(pickAsset?.pickId);
  const entry = history.find((row) => Number(row?.draftYear) === year);
  if (!entry) return null;
  const picks = Array.isArray(entry?.picks) ? entry.picks : [];
  let result = null;
  if (id) result = picks.find((row) => text(row?.draftPickAssetId) === id || text(row?.swapAssetId) === id) || null;
  if (!result) {
    result = picks.find((row) =>
      Number(row?.round || 0) === round &&
      normalizeName(row?.originalTeamName) === original
    ) || null;
  }
  return result ? { ...result, draftYear: year } : null;
}

function findCurrentDraftedPlayer(leagueData, outcome = {}) {
  const byName = currentOrHistoricalPlayer(leagueData, outcome?.playerName);
  if (byName) return byName;
  return null;
}

function findCurrentPickAsset(leagueData, pick = {}) {
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : []).find((row) => samePickAsset(row, pick)) || null;
}

function findLaterPickTrade(timeline = [], receivedPick = {}) {
  const originalEvent = receivedPick?.event;
  return timeline.find((event) =>
    event.sortValue > safeNumber(originalEvent?.sortValue, -1) &&
    event.sent.some((asset) => asset.type === "pick" && samePickAsset(asset, receivedPick))
  ) || null;
}

function buildPickLineage(context) {
  const historicalTimeline = context.historicalTradeTimeline || [];
  const acquired = [];
  const playerOrigins = new Map();
  const pickOrigins = new Map();

  // Walk the user's trade history in order and propagate the original outgoing
  // player through bridge assets. Example: Booker -> Fox -> BOS 1st should still
  // remember Booker as the root of that eventual pick, not stop at Fox.
  for (const event of historicalTimeline) {
    const sentPlayers = event.sent
      .filter((asset) => asset.type === "player" && asset.playerName)
      .sort((a, b) => safeNumber(b.overall, 0) - safeNumber(a.overall, 0));

    const inheritedOrigins = sentPlayers
      .map((asset) => playerOrigins.get(normalizeName(asset.playerName)) || {
        playerName: asset.playerName,
        overall: safeNumber(asset.overall, 0),
        rootEvent: event,
      })
      .filter((row) => row?.playerName);

    for (const sentPick of event.sent.filter((asset) => asset.type === "pick")) {
      const inherited = pickOrigins.get(pickKey(sentPick));
      if (inherited) inheritedOrigins.push(inherited);
    }

    inheritedOrigins.sort((a, b) => safeNumber(b.overall, 0) - safeNumber(a.overall, 0));
    const rootAnchor = inheritedOrigins[0] || null;

    for (const pick of event.received.filter((asset) => asset.type === "pick" && Number(asset.round) === 1)) {
      const origin = rootAnchor ? {
        playerName: rootAnchor.playerName,
        overall: rootAnchor.overall,
        rootEvent: rootAnchor.rootEvent || event,
      } : null;
      acquired.push({ ...pick, event, anchorPlayer: origin });
      if (origin) pickOrigins.set(pickKey(pick), origin);
    }

    // Keep origin lineage even for second-round picks/swaps so a later trade can
    // carry the same root story into whatever asset comes back.
    if (rootAnchor) {
      for (const pick of event.received.filter((asset) => asset.type === "pick")) {
        pickOrigins.set(pickKey(pick), {
          playerName: rootAnchor.playerName,
          overall: rootAnchor.overall,
          rootEvent: rootAnchor.rootEvent || event,
        });
      }
      for (const asset of event.received.filter((row) => row.type === "player" && row.playerName)) {
        playerOrigins.set(normalizeName(asset.playerName), {
          playerName: rootAnchor.playerName,
          overall: Math.max(safeNumber(rootAnchor.overall, 0), safeNumber(asset.overall, 0)),
          rootEvent: rootAnchor.rootEvent || event,
        });
      }
    }
  }

  const seen = new Set();
  const stories = [];
  for (const pick of acquired) {
    const key = pickKey(pick);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const outcome = findDraftOutcomeForPick(context.leagueData, pick);
    const currentPick = findCurrentPickAsset(context.leagueData, pick);
    const laterTrade = findLaterPickTrade(historicalTimeline, pick);
    const anchor = pick.anchorPlayer?.playerName ? `${pick.anchorPlayer.playerName} trade` : `trade with ${pick.event.partnerTeam}`;
    let headline = "";
    let score = 0;
    let draftedPlayer = null;

    if (outcome) {
      draftedPlayer = findCurrentDraftedPlayer(context.leagueData, outcome);
      const selection = `No. ${outcome.pick}`;
      const owner = outcome.currentOwnerTeamName || outcome.teamName || "the team that held it";
      headline = `The ${describePickAsset(pick, { includeProtection:false })} from the ${anchor} became the ${selection} pick. ${teamMarketName(owner)} used it on ${outcome.playerName}.`;
      if (draftedPlayer && playerOverall(draftedPlayer)) {
        const currentTeam = text(draftedPlayer?.teamName || draftedPlayer?.team);
        headline += ` ${outcome.playerName} is now ${playerOverall(draftedPlayer)} OVR${currentTeam && normalizeName(currentTeam) !== normalizeName(owner) ? ` with ${teamMarketName(currentTeam)}` : ""}.`;
        const latestStints = playerSeasonStints(context.leagueData, context.previousEntry, outcome.playerName)
          .slice()
          .sort((a, b) => b.games - a.games);
        const latestStint = latestStints.find((row) => !currentTeam || normalizeName(row.teamName) === normalizeName(currentTeam)) || latestStints[0] || null;
        if (latestStint?.games) {
          const production = formatHumanProduction(latestStint);
          headline += ` He played ${latestStint.games} games last season${production ? ` and averaged ${production}` : ""}.`;
        }
        const accolades = playerAwardsInSeason(context.leagueData, outcome.playerName, context.seasonYear);
        if (accolades.length) headline += ` He also earned ${naturalList(accolades)}.`;
      }
      score = 92 + Math.max(0, safeNumber(outcome?.overall, 0) - 72) + Math.max(0, playerOverall(draftedPlayer) - 78);
    } else if (laterTrade) {
      const received = describeTradeAssets(laterTrade.received);
      headline = `${teamMarketName(context.canonical)} later moved the ${describePickAsset(pick, { includeProtection:false })}${received ? ` to ${teamMarketName(laterTrade.partnerTeam)} in a deal that brought back ${received}` : ` to ${teamMarketName(laterTrade.partnerTeam)}`}.`;
      score = 72;
    } else if (currentPick && safeNumber(pick?.year, 0) >= context.seasonYear) {
      headline = `${teamMarketName(context.canonical)} still owns the ${describePickAsset(pick)} from the ${anchor}.`;
      score = 58 + Math.max(0, 4 - (safeNumber(pick.year, context.seasonYear) - context.seasonYear)) * 3;
    }

    if (headline) stories.push({ pick, outcome, currentPick, laterTrade, draftedPlayer, headline, score, anchorPlayer:pick.anchorPlayer?.playerName || "" });
  }

  return stories.sort((a, b) => b.score - a.score).slice(0, 8);
}


function previousRotationAge(previousEntry, teamName) {
  const rows = previousTeamPlayerStats(previousEntry, teamName)
    .filter((row) => playerAge(row) > 0)
    .sort((a, b) => playerOverall(b) - playerOverall(a))
    .slice(0, 9);
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + playerAge(row), 0) / rows.length;
}

function buildFranchiseDirection(context) {
  const ledger = context.tradeLedger;
  const top = context.snapshot.top[0];
  const topOutgoing = ledger.rootOutgoingPlayers[0] || null;
  const topIncoming = ledger.retainedIncomingPlayers[0] || null;
  const previousWins = safeNumber(context.previousRow?.wins ?? context.previousRow?.w, 0);
  const netFirsts = ledger.netFirsts;
  const starOut = safeNumber(topOutgoing?.overall, 0);
  const starIn = safeNumber(topIncoming?.overall, 0);
  const currentTop = safeNumber(top?.ovr, 0);
  const youngCore = context.snapshot.youngCore.length;
  const market = teamMarketName(context.canonical);
  const ref = teamReference(context.canonical);
  const previousAverageAge = previousRotationAge(context.previousEntry, context.canonical);
  const currentAverageAge = safeNumber(context.snapshot.averageAge, 0);
  const ageDelta = previousAverageAge && currentAverageAge ? currentAverageAge - previousAverageAge : 0;
  let type = "retooling";
  let confidence = 60;

  if (context.previousRow?.champion) {
    type = "title_defense";
    confidence = 96;
  } else if ((ledger.firstsOut >= 2 && starIn >= 86) || (netFirsts <= -2 && starIn >= 84)) {
    type = "championship_push";
    confidence = 90;
  } else if (netFirsts >= 2 && starOut >= 85 && (starIn <= starOut - 4 || ledger.bridges.some((row) => row.overall >= 84))) {
    type = "rebuilding";
    confidence = 94;
  } else if (netFirsts >= 1 && starOut >= 83 && (currentTop >= 80 || youngCore >= 2)) {
    type = "retooling";
    confidence = 86;
  } else if (context.snapshot.direction === "developing") {
    type = "developing";
    confidence = 78;
  } else if (context.snapshot.direction === "contending" || previousWins >= 50) {
    type = "contending";
    confidence = 76;
  } else if (context.snapshot.direction === "rebuilding") {
    type = "rebuilding";
    confidence = 78;
  }

  let summary = "";
  if (type === "title_defense") summary = `${market} enters the season as the defending champion, so the roster is still being judged against a championship standard.`;
  else if (type === "championship_push") summary = `${market} made a clear win-now push, spending future assets to add more high-end talent to the current roster.`;
  else if (type === "rebuilding") {
    const pickNote = netFirsts > 0
      ? ` and coming out of those moves with ${netFirsts} additional first-round pick${netFirsts === 1 ? "" : "s"}`
      : "";
    const ageNote = ageDelta <= -1.5 ? " The main rotation is also noticeably younger than it was last season." : "";
    summary = topOutgoing
      ? `${market} has shifted toward a rebuild after moving ${topOutgoing.playerName}${pickNote}.${ageNote}`
      : `${market} is entering the season in a rebuild, with development and future assets carrying more weight than short-term results.${ageNote}`;
  } else if (type === "retooling") {
    const ageNote = ageDelta <= -1.5 ? " The roster also got younger in the process." : "";
    summary = `${market} looks to be retooling rather than starting over completely, changing important pieces while keeping a competitive core in place.${ageNote}`;
  }
  else if (type === "developing") summary = `${market} is still in a development phase, with the season centered on how quickly the young core can take on larger roles.`;
  else summary = `${market} still has a roster built to compete now, so the season will be judged more by playoff progress than by regular-season development.`;

  return {
    type,
    confidence,
    summary,
    metrics: {
      firstsIn: ledger.firstsIn,
      firstsOut: ledger.firstsOut,
      netFirsts,
      secondsIn: ledger.secondsIn,
      secondsOut: ledger.secondsOut,
      swapsIn: ledger.swapsIn,
      swapsOut: ledger.swapsOut,
      rootOutgoingOverall: starOut,
      retainedIncomingOverall: starIn,
      currentTopOverall: currentTop,
      youngCoreCount: youngCore,
      previousWins,
      previousAverageAge: previousAverageAge ? Number(previousAverageAge.toFixed(1)) : 0,
      currentAverageAge: currentAverageAge ? Number(currentAverageAge.toFixed(1)) : 0,
      ageDelta: ageDelta ? Number(ageDelta.toFixed(1)) : 0,
      salaryDelta: ledger.salaryDelta,
    },
    statement: summary,
    teamReference: ref,
  };
}

function buildMajorTradeNarratives(context) {
  const ledger = context.tradeLedger;
  const ref = teamReference(context.canonical);
  const market = teamMarketName(context.canonical);
  const stories = [];
  const root = ledger.rootOutgoingPlayers[0] || null;

  if (root?.event) {
    const received = describeTradeAssets(root.event.received);
    const checkpoint = tradeCheckpointForTeam(root.event, context.canonical);
    stories.push(`${market} traded ${root.playerName} to ${teamMarketName(root.partnerTeam || root.event.partnerTeam)}${received ? ` for ${received}` : ""}.${checkpoint ? ` ${market} was ${checkpoint.record} at the time.` : ""}`);

    const bridgesFromRoot = ledger.bridges.filter((bridge) => bridge.acquiredEvent?.id === root.event.id);
    for (const bridge of bridgesFromRoot.slice(0, 2)) {
      const stintText = bridge.games
        ? ` He played ${bridge.games} games for ${teamMarketName(context.canonical)}`
        : bridge.days != null && bridge.days <= 120
          ? ` He stayed only ${bridge.days} days`
          : " He was only a short-term part of the plan";
      const returnText = describeTradeAssets(bridge.receivedWhenMoved);
      stories.push(`${bridge.playerName} did not become a long-term replacement.${stintText} before ${ref} moved him to ${teamMarketName(bridge.movedTo)}${returnText ? ` for ${returnText}` : ""}.`);
    }

    if (ledger.netFirsts >= 2) {
      stories.push(`Across those moves, ${market} gained ${ledger.netFirsts} more first-round picks than it sent out, making the overall direction much more like a rebuild than a simple star-for-star replacement.`);
    } else if (ledger.netFirsts === 1) {
      stories.push(`The trade sequence also left ${ref} with one additional first-round pick, giving the front office more flexibility for the next move.`);
    }
  } else {
    const majorIncoming = ledger.retainedIncomingPlayers[0] || null;
    if (majorIncoming?.event) {
      const sent = describeTradeAssets(majorIncoming.event.sent);
      stories.push(`${market} acquired ${majorIncoming.playerName} from ${majorIncoming.event.partnerTeam}${sent ? ` by sending out ${sent}` : ""}.`);
      if (ledger.firstsOut >= 2) stories.push(`The price included ${ledger.firstsOut} first-round picks, so this was a clear bet on the current roster rather than a move for the distant future.`);
    }
  }

  if (!stories.length) {
    for (const event of [...ledger.timeline].sort((a, b) => b.score - a.score).slice(0, 2)) {
      const sent = describeTradeAssets(event.sent);
      const received = describeTradeAssets(event.received);
      if (!sent && !received) continue;
      stories.push(`${market} dealt with ${event.partnerTeam}${sent ? ` by sending ${sent}` : ""}${received ? `${sent ? " and" : " and"} receiving ${received}` : ""}.`);
    }
  }

  return stories;
}

function buildHistoricalAssetHighlights(context) {
  const rows = [
    ...(context.tradePartnerAftermath || []).map((row) => ({ type:"player_aftermath", score:row.score, headline:row.headline, data:row })),
    ...(context.pickLineage || []).map((row) => ({ type:"pick_lineage", score:row.score, headline:row.headline, data:row })),
  ];
  const seen = new Set();
  return rows
    .sort((a, b) => b.score - a.score)
    .filter((row) => {
      const key = normalizeName(row.headline);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
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
        headline: `${playerNameOf(player)} (${playerOverall(player)} OVR) is eligible for a ${extensionType} extension and has ${yearsLeft} year${yearsLeft === 1 ? "" : "s"} left on his current deal.`,
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

function immersiveProgressionHeadline(row = {}) {
  const delta = safeNumber(row?.delta, 0);
  const magnitude = Math.abs(delta);
  const name = text(row?.name) || "A key player";
  const team = text(row?.teamName) || "his team";
  const current = safeNumber(row?.currentOverall, 0);
  const seed = `progression-story:${name}:${team}:${delta}:${current}`;

  if (delta > 0) {
    if (magnitude >= 6) {
      return choose(seed, [
        `${name} returned looking like a different level of player, emerging at ${current} OVR and giving ${team} a new piece to build around`,
        `Few players changed their standing more than ${name}, whose leap to ${current} OVR reshaped what ${team} can reasonably expect from him`,
        `${name}'s development accelerated in a major way, pushing him to ${current} OVR and changing the ceiling of ${team}'s rotation`,
      ]);
    }
    if (magnitude >= 4) {
      return choose(seed, [
        `${name} took a clear step forward, arriving at ${current} OVR with a larger role now within reach for ${team}`,
        `The year was an important one for ${name}; his game moved forward enough to bring him to ${current} OVR for ${team}`,
        `${name} came back noticeably sharper, climbing to ${current} OVR and giving ${team} more to work with`,
      ]);
    }
    return choose(seed, [
      `${name} made steady progress and enters the year at ${current} OVR for ${team}`,
      `${name}'s development kept moving in the right direction, nudging him to ${current} OVR for ${team}`,
    ]);
  }

  if (magnitude >= 6) {
    return choose(seed, [
      `The decline around ${name} became difficult to ignore; he enters the year at ${current} OVR, forcing ${team} to rethink how heavily it can lean on him`,
      `${name} no longer looks quite like the same force, sliding to ${current} OVR and leaving ${team} with a more complicated version of its old hierarchy`,
      `Time caught up with ${name} in a meaningful way. At ${current} OVR, his place in ${team}'s pecking order is no longer as secure as it once was`,
    ]);
  }
  if (magnitude >= 4) {
    return choose(seed, [
      `${name} lost some of his old edge over the course of the year and now sits at ${current} OVR, a change ${team} will have to account for`,
      `The season took something out of ${name}; his slide to ${current} OVR changes the amount of responsibility ${team} can comfortably put on him`,
      `${name}'s game showed real signs of wear, leaving him at ${current} OVR and subtly changing the shape of ${team}'s rotation`,
    ]);
  }
  return choose(seed, [
    `${name} slipped a little over the year and enters the season at ${current} OVR for ${team}`,
    `${name} gave back some ground and now sits at ${current} OVR, something ${team} will be watching closely`,
  ]);
}

function cleanStorySentence(value) {
  const clean = text(value).replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
  return clean ? `${clean}.` : "";
}

function buildImmersiveTransactionParagraph(context, stories = [], ref = "the team") {
  const rows = (stories || []).map(cleanStorySentence).filter(Boolean).slice(0, 3);
  if (!rows.length) {
    return `The main rotation came through the offseason mostly intact, so ${ref} will be relying more on continuity and internal improvement than on a dramatic roster reset.`;
  }
  if (rows.length === 1) return rows[0];

  const seed = `team-transactions:${context?.canonical || ref}:${context?.seasonYear || ""}:${rows.join("|")}`;
  const bridgeOne = choose(seed, [
    "That was only the beginning of the reshaping.",
    "The front office did not stop there.",
    "It became one part of a broader change in direction.",
    "The move set the tone for the rest of the roster work.",
  ]);
  const bridgeTwo = choose(`${seed}:2`, [
    "By the time the dust settled, another important piece of the rotation had changed as well.",
    "The final shape of the offseason added one more meaningful wrinkle.",
    "Another move completed the picture and gave the roster a noticeably different feel.",
  ]);

  return rows.length === 2
    ? `${rows[0]} ${bridgeOne} ${rows[1]}`
    : `${rows[0]} ${bridgeOne} ${rows[1]} ${bridgeTwo} ${rows[2]}`;
}

function isMajorLeagueMovement(event = {}) {
  const score = safeNumber(event?.score, 0);
  const overall = safeNumber(event?.overall, 0);
  const kind = text(event?.movementKind || event?.type).toLowerCase();
  if (overall >= 84) return true;
  if (score >= 82) return true;
  if (kind.includes("trade") && overall >= 80 && score >= 74) return true;
  if ((kind.includes("sign") || kind.includes("free")) && overall >= 80 && score >= 72) return true;
  return false;
}

function buildLeagueMovementParagraph(movement = []) {
  const rows = (movement || []).filter(Boolean).slice(0, 5);
  if (!rows.length) {
    return "The league avoided a true balance-of-power move this time around; plenty changed at the margins, but no saved trade or free-agent signing was large enough to define the summer.";
  }

  const inSeasonTrades = rows.filter((event) => event.movementKind === "trade" && event.phase === "in_season");
  const offseasonTrades = rows.filter((event) => event.movementKind === "trade" && event.phase !== "in_season");
  const signings = rows.filter((event) => event.movementKind === "signing");
  const sections = [];

  if (inSeasonTrades.length) {
    sections.push(`The league had already started shifting before the summer arrived. ${inSeasonTrades.map((event) => cleanStorySentence(event.headline)).join(" ")}`);
  }
  if (offseasonTrades.length) {
    sections.push(`${inSeasonTrades.length ? "The offseason kept that movement going." : "The offseason opened with real movement around the league."} ${offseasonTrades.map((event) => cleanStorySentence(event.headline)).join(" ")}`);
  }
  if (signings.length) {
    sections.push(`${sections.length ? "Free agency added another layer." : "Free agency supplied the biggest change in the league's landscape."} ${signings.map((event) => cleanStorySentence(event.headline)).join(" ")}`);
  }

  return sections.join(" ");
}

function immersiveCoreParagraph(core = []) {
  if (!core.length) return "The rotation still needs a clear top group.";
  const first = core[0];
  const second = core[1];
  const third = core[2];
  if (!second) return `${first.name}, now ${first.ovr} OVR, stands alone as the clearest pillar of the roster.`;
  if (!third) return `${first.name} remains the player everything bends around at ${first.ovr} OVR, with ${second.name} forming the next layer of the core.`;
  return `${first.name} remains the player at the center of the roster at ${first.ovr} OVR. ${second.name} and ${third.name} form the next layer around him, giving the team a clearer hierarchy than a simple depth-chart reading would suggest.`;
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

function progressionStorySentence(row, { teamName = "" } = {}) {
  const name = text(row?.name) || "A rotation player";
  const delta = safeNumber(row?.delta, 0);
  const movement = Math.abs(delta);
  const current = safeNumber(row?.currentOverall, 0);
  const team = text(teamName || row?.teamName);
  const market = teamMarketName(team);
  const seed = `${name}|${team}|${delta}|${current}|progression_story`;

  if (!delta) return "";

  if (delta > 0) {
    const rise = movement >= 6
      ? "one of the summer's clearest internal leaps"
      : movement >= 4
        ? "a noticeable leap over the summer"
        : "another meaningful step forward";
    const impact = movement >= 5
      ? (market ? `That kind of jump changes what ${market} can reasonably ask of him this season.` : "That kind of jump can change his role immediately.")
      : (market ? `It gives ${market} a little more upside in the rotation than it had a year ago.` : "It gives his team more upside than it had a year ago.");
    const variants = [
      `${name} made ${rise}${current ? `, arriving at ${current} OVR after gaining ${movement} point${movement === 1 ? "" : "s"}` : ""}. ${impact}`,
      `${name} came back sharper and more complete than he was a year ago${current ? `, climbing to ${current} OVR` : ""}. The ${movement}-point rise is substantial enough to matter when roles are set in camp.`,
      `${name}'s development did not stall over the summer${current ? `; he now sits at ${current} OVR` : ""}, up ${movement} point${movement === 1 ? "" : "s"} from where he finished. ${impact}`,
    ];
    return choose(seed, variants);
  }

  const slip = movement >= 6
    ? "a major step back over the summer"
    : movement >= 4
      ? "a noticeable step back over the summer"
      : "a small step back compared with last season";
  const impact = movement >= 5
    ? (market ? `For ${market}, it is a large enough change to alter the way the top of the rotation is viewed.` : "It is a large enough change to alter how his role is viewed.")
    : (market ? `${market} will be hoping the slide does not become a longer-term trend.` : "His team will be hoping the slide does not become a longer-term trend.");
  const variants = [
    `${name} took ${slip}${current ? ` and opens the year at ${current} OVR, ${movement} point${movement === 1 ? "" : "s"} below where he finished` : ""}. ${impact}`,
    `${name} did not come out of the summer at quite the same level${current ? `, slipping to ${current} OVR` : ""}. The ${movement}-point drop is difficult to ignore, even if the season will decide how permanent it really is.`,
    `${name}'s trajectory bent the wrong way over the summer${current ? `, leaving him at ${current} OVR` : ""} after a ${movement}-point decline. ${impact}`,
  ];
  return choose(seed, variants);
}

function isMajorLeagueTransaction(event = {}) {
  const overall = safeNumber(event?.overall, 0);
  const score = safeNumber(event?.score, 0);
  if (event?.type === "trade") return overall >= 82 || score >= 86;
  if (event?.type === "free_agency") return overall >= 82 || score >= 84;
  return false;
}

function leagueTransactionStory(event = {}) {
  const name = text(event?.playerName) || "a major player";
  if (event?.type === "trade") {
    const from = teamMarketName(event?.fromTeam) || text(event?.fromTeam);
    const to = teamMarketName(event?.toTeam) || text(event?.toTeam);
    const overall = safeNumber(event?.overall, 0);
    const stature = overall >= 90
      ? "one of the league's true stars"
      : overall >= 86
        ? "a proven star-level piece"
        : overall >= 82
          ? "a high-end starter"
          : "an established rotation piece";
    const seed = `${name}|${from}|${to}|${event?.phase}|trade_story`;
    if (event?.phase === "in_season") {
      return choose(seed, [
        `${to} made one of last season's defining swings when it acquired ${name} from ${from}, moving ${stature} into a new situation before the year was over.`,
        `The league had already started shifting before the summer when ${name} was dealt from ${from} to ${to}. Moving ${stature} changed the shape of both teams.`,
      ]);
    }
    if (event?.phase === "offseason") {
      return choose(seed, [
        `The summer market shifted when ${to} landed ${name} from ${from}, adding ${stature} before opening night.`,
        `${name}'s move from ${from} to ${to} became one of the offseason's biggest trades, with ${stature} changing sides before camp.`,
      ]);
    }
    return choose(seed, [
      `${to} made one of the league's biggest roster swings by acquiring ${name} from ${from}, sending ${stature} into a new situation.`,
      `${name}'s move from ${from} to ${to} became one of the major transactions shaping the league around the new season.`,
    ]);
  }

  if (event?.type === "free_agency") {
    const to = teamMarketName(event?.toTeam) || text(event?.toTeam);
    const years = safeNumber(event?.years, 0);
    const aav = safeNumber(event?.aav, 0);
    const deal = years ? ` on a ${years}-year${aav ? `, ${compactMoney(aav)}-per-year` : ""} deal` : "";
    const seed = `${name}|${to}|${years}|${aav}|fa_story`;
    return choose(seed, [
      `Free agency shifted the balance again when ${to} signed ${name}${deal}, giving the roster another major piece before the new season.`,
      `${to} made one of the summer's loudest free-agent moves by bringing in ${name}${deal}. It was the kind of signing that immediately changes expectations around a rotation.`,
    ]);
  }

  return text(event?.headline);
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
    const owner = normalizeName(draftPickOwnerName(pick));
    const year = safeNumber(pick?.year ?? pick?.draftYear ?? pick?.season, 0);
    const round = safeNumber(pick?.round, 0);
    const active = !pick?.status || normalizeName(pick.status) === "active";
    return owner === target && year === draftYear && round === 1 && active;
  });
}

function totalFutureFirsts(leagueData, teamName, seasonYear, horizon = 4) {
  const target = normalizeName(teamName);
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : []).filter((pick) => {
    const owner = normalizeName(draftPickOwnerName(pick));
    const year = safeNumber(pick?.year ?? pick?.draftYear ?? pick?.season, 0);
    const round = safeNumber(pick?.round, 0);
    const active = !pick?.status || normalizeName(pick.status) === "active";
    return owner === target && round === 1 && active && year >= seasonYear + 1 && year <= seasonYear + horizon;
  }).length;
}

function draftPickProtectionText(pick = {}) {
  return text(pick?.displayProtection || pick?.protections || pick?.protection || pick?.conditions || "");
}

function draftPickSwapTeamName(pick = {}) {
  return text(
    pick?.swapWithTeam ||
    pick?.swap_with_team ||
    pick?.swapTeam ||
    pick?.otherTeam ||
    pick?.swap?.withTeam ||
    ""
  );
}

function externalFirstRoundAssets(leagueData, teamName, seasonYear, horizon = 7) {
  const target = normalizeName(teamName);
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [])
    .map((pick) => {
      const owner = draftPickOwnerName(pick);
      const originalTeam = draftPickOriginalTeamName(pick);
      const swapWithTeam = draftPickSwapTeamName(pick);
      const assetTypeRaw = normalizeName(pick?.assetType || pick?.type || "pick");
      const assetType = assetTypeRaw.includes("swap") ? "swap" : "pick";
      const externalTeam = normalizeName(originalTeam) && normalizeName(originalTeam) !== target
        ? originalTeam
        : normalizeName(swapWithTeam) && normalizeName(swapWithTeam) !== target
          ? swapWithTeam
          : "";
      return {
        id: text(pick?.id || pick?.pickId),
        owner,
        originalTeam,
        externalTeam,
        swapWithTeam,
        assetType,
        year: safeNumber(pick?.year ?? pick?.draftYear ?? pick?.season, 0),
        round: safeNumber(pick?.round, 0),
        protection: draftPickProtectionText(pick),
        status: normalizeName(pick?.status || "active"),
        source: pick,
      };
    })
    .filter((pick) => (
      normalizeName(pick.owner) === target &&
      pick.round === 1 &&
      (!pick.status || pick.status === "active") &&
      pick.year >= seasonYear + 1 &&
      pick.year <= seasonYear + horizon &&
      Boolean(pick.externalTeam)
    ))
    .sort((a, b) => a.year - b.year || a.externalTeam.localeCompare(b.externalTeam));
}

function externalPickAssetLabel(asset = {}) {
  const year = safeNumber(asset?.year, 0) || "future";
  if (asset?.assetType === "swap") return `${year} first-round swap right`;
  const protection = text(asset?.protection);
  if (/unprotected/i.test(protection)) return `unprotected ${year} first`;
  if (protection) return `${year} first (${protection})`;
  return `${year} first`;
}

function externalPickTeamState(previousRow, snapshot) {
  const wins = safeNumber(previousRow?.wins ?? previousRow?.w, NaN);
  if (Number.isFinite(wins)) {
    if (wins <= 28) return "bottom";
    if (wins <= 37) return "lottery_mix";
    if (wins <= 46) return "middle";
    if (wins <= 53) return "strong";
    return "elite";
  }
  if (snapshot?.direction === "rebuilding") return "bottom";
  if (snapshot?.direction === "developing") return "lottery_mix";
  if (snapshot?.direction === "contending") return "strong";
  return "middle";
}

function externalPickImpactForDirection(teamName, direction = "") {
  const market = teamMarketName(teamName);
  if (["rebuilding", "developing"].includes(direction)) {
    return `For ${possessive(market)} ${direction === "rebuilding" ? "rebuild" : "young core"}, outside firsts create another path to cost-controlled talent even if ${market} improves enough to push its own picks later in the round.`;
  }
  if (["contending", "championship_push", "title_defense"].includes(direction)) {
    return `For a team trying to win now, that outside draft capital can either become inexpensive rotation talent or be used in another trade without relying only on ${possessive(market)} own firsts.`;
  }
  return `That outside draft capital keeps both options open: ${market} can hold it for another young player or use it as trade currency if a bigger roster move becomes available.`;
}

function buildExternalFirstRoundPickIntel({ leagueData, teamName, seasonYear, previousEntry = null, direction = "retooling" } = {}) {
  const assets = externalFirstRoundAssets(leagueData, teamName, seasonYear, 7);
  const market = teamMarketName(teamName);
  if (!assets.length) {
    return { count: 0, teamCount: 0, assets: [], groups: [], teamLead: "", portfolioSummary: "" };
  }

  const grouped = new Map();
  for (const asset of assets) {
    const key = normalizeName(asset.externalTeam);
    if (!grouped.has(key)) grouped.set(key, { externalTeam: asset.externalTeam, assets: [] });
    grouped.get(key).assets.push(asset);
  }

  const groups = [...grouped.values()].map((group) => {
    const outsideTeam = group.externalTeam;
    const outsideMarket = teamMarketName(outsideTeam);
    const outsideTeamRow = previousTeamRow(previousEntry, outsideTeam);
    const outsideTeamObj = findTeam(leagueData, outsideTeam);
    const snap = outsideTeamObj ? rosterSnapshot(outsideTeamObj) : null;
    const state = externalPickTeamState(outsideTeamRow, snap);
    const sortedAssets = group.assets.slice().sort((a, b) => a.year - b.year);
    const labels = sortedAssets.map(externalPickAssetLabel);
    const nearest = sortedAssets[0];
    const farthest = sortedAssets.at(-1);
    const nearestYearsAway = safeNumber(nearest?.year, seasonYear) - seasonYear;
    const farthestYearsAway = safeNumber(farthest?.year, seasonYear) - seasonYear;
    const record = formatRecord(outsideTeamRow);
    const finish = outsideTeamRow ? formatFinish(outsideTeamRow) : "";
    const top = snap?.top?.[0] || null;
    const topAging = (snap?.top || []).filter((row) => row.age >= 31 && row.ovr >= 82);
    const allUnprotected = sortedAssets.every((asset) => /unprotected/i.test(text(asset.protection)));
    const protectedAssets = sortedAssets.filter((asset) => text(asset.protection) && !/unprotected/i.test(text(asset.protection)));
    const swaps = sortedAssets.filter((asset) => asset.assetType === "swap");

    const sentences = [`${market} controls ${naturalList(labels)} tied to ${outsideTeam}.`];
    if (outsideTeamRow && record) {
      sentences.push(`${outsideMarket} went ${record} and ${finish} last season.`);
    } else if (snap) {
      if (snap.direction === "contending") sentences.push(`${outsideMarket} currently has a contender-level roster${top ? ` led by ${top.name} (${top.ovr} OVR)` : ""}.`);
      else if (snap.direction === "rebuilding") sentences.push(`${outsideMarket} currently profiles as a rebuilding team${top ? ` with ${top.name} (${top.ovr} OVR) as its highest-rated player` : ""}.`);
      else if (snap.direction === "developing") sentences.push(`${outsideMarket} has a young developing roster${top ? ` led by ${top.name} (${top.ovr} OVR)` : ""}.`);
      else sentences.push(`${outsideMarket} currently sits in a middle competitive tier${top ? ` with ${top.name} (${top.ovr} OVR) at the top of the roster` : ""}.`);
    }

    if (state === "bottom") {
      sentences.push(`That gives the ${nearest.year} asset real lottery upside if ${outsideMarket} remains near the bottom of the standings.`);
    } else if (state === "lottery_mix") {
      sentences.push(`The ${nearest.year} asset has meaningful upside because a modest swing in ${possessive(outsideMarket)} record could move it from the middle of the first round into the lottery.`);
    } else if (state === "middle") {
      sentences.push(`The ${nearest.year} asset is difficult to pin down right now; ${outsideMarket} is close enough to the playoff line that a few wins either way could materially change the slot.`);
    } else {
      sentences.push(`If ${outsideMarket} stays at that level, the ${nearest.year} asset is more likely to land later in the first round than near the lottery.`);
    }

    if (sortedAssets.length > 1 && farthestYearsAway >= 3 && farthest.year !== nearest.year) {
      if ((snap?.averageAge || 0) >= 28.5 || topAging.length) {
        const ageDetail = snap?.averageAge ? ` its current top-nine rotation averages ${snap.averageAge.toFixed(1)} years old` : " its current core already leans veteran";
        sentences.push(`The ${farthest.year} asset carries more long-range volatility because${ageDetail}; any decline before that draft would increase its value.`);
      } else if ((snap?.averageAge || 99) <= 26.2 && (snap?.youngCore?.length || 0) >= 2) {
        sentences.push(`The ${farthest.year} asset is less obviously favorable because ${outsideMarket} has a young core that could still be improving when that pick conveys, although the distance leaves plenty of uncertainty.`);
      } else {
        sentences.push(`The ${farthest.year} asset is much harder to price this far out, which gives it more variance than the nearer pick.`);
      }
    } else if (nearestYearsAway >= 3 && snap) {
      if ((snap.averageAge || 0) >= 28.5 || topAging.length) sentences.push(`Because the pick is still ${nearestYearsAway} years away and ${possessive(outsideMarket)} core leans older, its upside could grow if that roster declines before it conveys.`);
      else if ((snap.averageAge || 99) <= 26.2 && (snap.youngCore?.length || 0) >= 2) sentences.push(`Because the pick is still ${nearestYearsAway} years away and ${outsideMarket} has a young core, its value depends heavily on whether that group keeps improving.`);
    }

    if (allUnprotected && swaps.length === 0) {
      sentences.push(`${sortedAssets.length === 1 ? "It is" : "Those picks are"} unprotected, so ${market} gets the full draft-position benefit of any ${outsideMarket} decline.`);
    } else {
      for (const asset of protectedAssets.slice(0, 2)) {
        sentences.push(`The ${asset.year} pick is ${text(asset.protection)}, which limits the best-case draft position available to ${market} in that year.`);
      }
      if (swaps.length) sentences.push(`The swap value only becomes meaningful if the outside team's draft slot is more favorable when the order is set.`);
    }

    const impact = externalPickImpactForDirection(teamName, direction);
    sentences.push(impact);

    let score = 60;
    if (["bottom", "lottery_mix"].includes(state)) score += 18;
    if (allUnprotected) score += 12;
    if (sortedAssets.length >= 2) score += 8;
    if (farthestYearsAway >= 3 && ((snap?.averageAge || 0) >= 28.5 || topAging.length)) score += 8;
    if (protectedAssets.length) score -= 5;

    const teamLead = `${market} also owns ${naturalList(labels)} tied to ${outsideTeam}. ${state === "bottom" || state === "lottery_mix"
      ? `${outsideMarket} is currently weak enough that the nearest of those assets carries real upside.`
      : `${outsideMarket} is currently competitive, so the nearer pick leans later while the longer-dated value remains less certain.`}`;

    return {
      externalTeam: outsideTeam,
      assets: sortedAssets,
      state,
      score,
      teamLead,
      headline: sentences.join(" "),
      previousRecord: record,
      previousFinish: finish,
      rosterDirection: snap?.direction || "",
      rosterAverage: snap?.average ? Number(snap.average.toFixed(1)) : 0,
      rosterAverageAge: snap?.averageAge ? Number(snap.averageAge.toFixed(1)) : 0,
      topPlayer: top ? { name: top.name, overall: top.ovr, age: top.age } : null,
    };
  }).sort((a, b) => b.score - a.score || a.assets[0]?.year - b.assets[0]?.year);

  const teams = groups.map((row) => row.externalTeam);
  const unprotectedCount = assets.filter((asset) => /unprotected/i.test(text(asset.protection))).length;
  const portfolioSummary = `${market} controls ${assets.length} outside first-round asset${assets.length === 1 ? "" : "s"} tied to ${naturalList(teams)}.${unprotectedCount ? ` ${unprotectedCount} ${unprotectedCount === 1 ? "is" : "are"} unprotected, preserving the full upside if those teams fall in the standings.` : ""} ${externalPickImpactForDirection(teamName, direction)}`;

  return {
    count: assets.length,
    teamCount: groups.length,
    assets,
    groups,
    teamLead: groups[0]?.teamLead || "",
    portfolioSummary,
  };
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
  const market = teamMarketName(context.canonical);
  const isIncoming = normalizeName(event?.toTeam) === normalizeName(context.canonical);
  const current = currentLeaguePlayer(context, event?.playerName);
  const previous = previousPlayerRow(context, event?.playerName);
  const fit = basketballFitPhrase(current || previous || {}, isIncoming ? "add" : "remove");
  const stint = playerStintOnTeam(context.leagueData, context.previousEntry, event?.playerName, context.canonical);

  if (isIncoming) {
    const stayed = normalizeName(current?.teamName) === normalizeName(context.canonical);
    if (!stayed) {
      const stintText = stint?.games ? ` after only ${stint.games} games with the team` : " after a short stay";
      return `${market} acquired ${event.playerName} from ${event.fromTeam}, but he was moved again${stintText}.`;
    }
    const production = stint ? formatHumanProduction(stint) : "";
    return `${market} acquired ${event.playerName} from ${event.fromTeam}. ${production ? `He gave the team ${production}, and he ${fit}.` : `He ${fit}.`}`;
  }

  const destination = event?.toTeam || current?.teamName || "another team";
  return `${market} traded ${event.playerName} to ${destination}. The move ${fit}.`;
}


function freeAgencyAdditionSentence(context, event) {
  const player = currentLeaguePlayer(context, event?.playerName);
  const fit = basketballFitPhrase(player || {}, "add");
  const years = safeNumber(event?.years, 0);
  const deal = years ? ` on a ${years}-year deal` : "";
  return `${teamMarketName(context.canonical)} signed ${event.playerName} in free agency${deal}. He ${fit}.`;
}


function freeAgencyDepartureSentence(context, departure) {
  const previous = previousPlayerRow(context, departure?.name) || departure;
  const stint = playerStintOnTeam(context.leagueData, context.previousEntry, departure?.name, context.canonical);
  const production = stint ? formatHumanProduction(stint) : roundedProductionText(previous);
  const destination = departure?.destination && normalizeName(departure.destination) !== "free agency"
    ? ` to ${departure.destination}`
    : "";
  return `${teamMarketName(context.canonical)} lost ${departure.name}${destination} in free agency.${production ? ` He had averaged ${production} for the team.` : ""}`;
}


function buildTeamTransactionStories(context) {
  const stories = [];
  const seen = new Set();
  const add = (value) => {
    const clean = text(value).replace(/\s+/g, " ");
    const key = normalizeName(clean);
    if (!clean || !key || seen.has(key)) return;
    seen.add(key);
    stories.push(clean);
  };

  for (const story of context.majorTradeNarratives || []) add(story);

  const coveredPlayers = new Set([
    ...context.tradeLedger.rootOutgoingPlayers.map((row) => normalizeName(row.playerName)),
    ...context.tradeLedger.bridges.map((row) => normalizeName(row.playerName)),
    ...context.tradeLedger.retainedIncomingPlayers.map((row) => normalizeName(row.playerName)),
  ]);

  for (const event of [...context.activity.signings].sort((a, b) => b.score - a.score).slice(0, 3)) {
    add(freeAgencyAdditionSentence(context, event));
  }

  const tradedOut = new Set(context.activity.outgoingTrades.map((row) => normalizeName(row.playerName)));
  for (const row of (context.turnover?.departures || [])
    .filter((item) => !tradedOut.has(normalizeName(item.name)))
    .filter((item) => safeNumber(item.previousOverall, 0) >= 76 || safeNumber(item?.stats?.PTS ?? item?.stats?.ppg, 0) >= 9)
    .slice(0, 3)) {
    add(freeAgencyDepartureSentence(context, row));
  }

  for (const event of context.activity.significant) {
    if (coveredPlayers.has(normalizeName(event?.playerName))) continue;
    add(event.type === "free_agency" ? freeAgencyAdditionSentence(context, event) : tradeAftermathSentence(context, event));
    if (stories.length >= 7) break;
  }

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
    headline: progressionStorySentence(row),
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
    evidence = progressionStorySentence(row, { teamName: current.canonical });
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
  const market = teamMarketName(canonical);
  let summary = "";
  if (average >= 74) {
    summary = `${market} enters the season with strong locker-room morale.`;
  } else if (average >= 64) {
    summary = `${market} starts the year with mostly positive locker-room morale, although a few players still have concerns.`;
  } else if (average >= 54) {
    summary = `Locker-room morale is mixed entering the season.`;
  } else {
    summary = `Locker-room morale is low entering the season, with several players carrying frustration from last year.`;
  }
  if (previousRow?.madePlayoffs && !previousRow?.champion && !previousRow?.finals && average < 62) {
    summary += ` ${playoffMoodPhrase(previousRow)} is still bothering some players.`;
  } else if ((previousRow?.conferenceFinals || previousRow?.finals || previousRow?.champion) && average >= 68) {
    summary += ` Last season's playoff run has also given the group some confidence.`;
  }

  const items = [];
  for (const row of unsettled) {
    const reason = moodReasonText(row);
    items.push(`${row.name} has one of the lower mood scores on the team${row.trend ? ` and is trending ${row.trend}` : ""}${reason ? `; ${reason}` : ""}.`);
  }
  if (!items.length && upbeat.length) {
    items.push(`${naturalList(upbeat.map((row) => row.name))} ${upbeat.length === 1 ? "has" : "have"} some of the strongest mood scores on the roster.`);
  }
  if (falling >= 3 && average < 66) items.push(`${falling} players currently have a falling mood trend, so the team will want a good start.`);
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
    else if (peer.progressionNet >= 3) detail = `several important players came back improved, giving the rotation a noticeable internal lift`;
    else if (peer.progressionNet <= -3) detail = `several important players slipped over the summer, taking some of the edge off the rotation`;
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
    items.push(`${row.name} is ${row.age} and still ${row.ovr} OVR, so keeping him healthy remains important.`);
  }
  for (const row of context.extensionWatch.slice(0, 2)) items.push(row.headline);
  const extensionNames = new Set(context.extensionWatch.map((row) => normalizeName(row.name)));
  for (const row of context.ownExpiringWatch.filter((item) => !extensionNames.has(normalizeName(item.name))).slice(0, 2)) {
    items.push(`${row.name} (${row.overall} OVR) can become a free agent after this season.`);
  }
  return uniqueNames(items, 6);
}

function primaryStoryline(context) {
  const direction = context.franchiseDirection;
  const top = context.snapshot.top[0];
  const rootOutgoing = context.tradeLedger.rootOutgoingPlayers[0] || null;
  const topIncoming = context.tradeLedger.retainedIncomingPlayers[0] || null;

  if (context.previousRow?.champion) {
    return { type:"title_defense", subject:context.canonical, statement:`${teamMarketName(context.canonical)} enters the season as the defending champion.` };
  }
  if (direction?.type === "rebuilding") {
    return {
      type:"rebuild",
      subject:rootOutgoing?.playerName || top?.name || context.canonical,
      statement:direction.summary,
    };
  }
  if (direction?.type === "championship_push") {
    return {
      type:"win_now",
      subject:topIncoming?.playerName || top?.name || context.canonical,
      statement:direction.summary,
    };
  }
  if (direction?.type === "retooling") {
    return {
      type:"retool",
      subject:rootOutgoing?.playerName || topIncoming?.playerName || top?.name || context.canonical,
      statement:direction.summary,
    };
  }
  if (direction?.type === "developing") {
    return {
      type:"development",
      subject:context.snapshot.youngCore[0]?.name || top?.name || context.canonical,
      statement:direction.summary,
    };
  }
  if (direction?.type === "contending") {
    return { type:"contending", subject:top?.name || context.canonical, statement:direction.summary };
  }
  return { type:"direction", subject:top?.name || context.canonical, statement:direction?.summary || `${teamMarketName(context.canonical)} enters the season with several roster decisions still to sort out.` };
}


function buildTeamSections(context) {
  const transactionItems = context.transactionStories || [];
  const aftermathItems = (context.assetHighlights || []).map((row) => row.headline);
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
    { title: "What happened after the trades", items: aftermathItems.slice(0, 5) },
    { title: "Pressure points", items: concernItems.slice(0, 5) },
    { title: "Contract watch", items: contractItems.slice(0, 6) },
    { title: "Locker room pulse", items: moodItems.slice(0, 5) },
  ].filter((section) => section.items.length);
}


function buildLeagueSections(context) {
  const conferenceItems = context.conferenceCompetition.map((row) => row.headline);
  const majorTrades = context.leagueBoard.trades
    .filter((event) => isMajorLeagueTransaction(event))
    .slice(0, 6)
    .map((event) => event.headline);
  const franchiseShifts = context.leagueBoard.franchiseShifts.slice(0, 5).map((event) => event.headline);
  const majorSignings = context.leagueBoard.signings
    .filter((event) => isMajorLeagueTransaction(event))
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
    { title: "Outside first-round assets", items: (context.externalPickIntel?.groups || []).slice(0, 4).map((row) => row.headline) },
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
  const { canonical, previousRow, previousStats, snapshot, teamProgression } = context;
  const market = teamMarketName(canonical);
  const ref = teamReference(canonical);
  const record = formatRecord(previousRow);
  const finish = formatFinish(previousRow);
  const leader = previousStats[0];
  const leaderProduction = leader ? roundedProductionText(leader) : "";

  const openingParts = [];
  if (previousRow) openingParts.push(`${market} finished ${record || "last season"} and ${finish}.`);
  else openingParts.push(`${market} enters the season without a complete prior-season record in the save.`);
  if (leader && leaderProduction) openingParts.push(`${leader.name} led the team with ${leaderProduction}.`);
  if (context.franchiseDirection?.summary) openingParts.push(context.franchiseDirection.summary);
  const first = openingParts.join(" ");

  const transactionStories = context.transactionStories || [];
  const second = buildImmersiveTransactionParagraph(context, transactionStories, ref);

  const core = snapshot.top.slice(0, 3);
  const coreText = immersiveCoreParagraph(core);
  const notableProgression = teamProgression.filter((row) => Math.abs(safeNumber(row.delta, 0)) >= 2).slice(0, 3);
  const progressionText = notableProgression.length
    ? ` ${notableProgression.map((row) => progressionStorySentence(row, { teamName: canonical })).filter(Boolean).join(" ")}`
    : "";
  const highlight = context.assetHighlights?.[0]?.headline || "";
  const third = `${coreText}${progressionText}${highlight ? ` ${highlight}` : ""}`.trim();

  const concerns = buildTeamConcerns(context).slice(0, 3);
  const futureFirsts = context.futureFirsts;
  const futureCapital = Number.isFinite(Number(futureFirsts))
    ? `${market} currently controls ${futureFirsts} listed first-round pick${futureFirsts === 1 ? "" : "s"} over the next four drafts.${context.externalPickIntel?.teamLead ? ` ${context.externalPickIntel.teamLead}` : ""}`
    : (context.externalPickIntel?.teamLead || "");
  const mood = context.moodPulse?.summary || "";
  const fourth = [
    concerns.length ? concerns.join(" ") : "",
    futureCapital,
    mood,
  ].filter(Boolean).join(" ");

  return [first, second, third, fourth].filter(Boolean);
}


function buildLeagueParagraphs(context) {
  const { leagueBoard, previousEntry } = context;
  const champ = text(previousEntry?.champion);
  const awardEvents = leagueBoard.events.filter((event) => event.type === "award").slice(0, 3);
  const firstParts = [];
  if (champ) firstParts.push(`${champ} won last season's NBA championship.`);
  else firstParts.push("The previous champion is not fully recorded in this save.");
  for (const event of awardEvents) firstParts.push(`${event.headline}.`);
  const first = firstParts.join(" ");

  const majorTrades = leagueBoard.trades
    .filter((event) => isMajorLeagueTransaction(event))
    .sort((a, b) => b.score - a.score);
  const majorSignings = leagueBoard.signings
    .filter((event) => isMajorLeagueTransaction(event))
    .sort((a, b) => b.score - a.score);

  const inSeason = majorTrades.filter((event) => event.phase === "in_season").slice(0, 2);
  const offseasonTrades = majorTrades.filter((event) => event.phase === "offseason").slice(0, 2);
  const unphasedTrades = majorTrades.filter((event) => event.phase !== "in_season" && event.phase !== "offseason").slice(0, 1);
  const summerSignings = majorSignings.slice(0, 2);
  const movementParts = [];

  if (inSeason.length) {
    movementParts.push(`The reshaping of the league actually started before the summer. ${inSeason.map(leagueTransactionStory).join(" ")}`);
  }
  const summerMovement = [...offseasonTrades, ...summerSignings]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (summerMovement.length) {
    movementParts.push(`${inSeason.length ? "The offseason pushed that movement even further." : "The offseason did not leave the league standing still."} ${summerMovement.map(leagueTransactionStory).join(" ")}`);
  }
  if (unphasedTrades.length) {
    movementParts.push(unphasedTrades.map(leagueTransactionStory).join(" "));
  }

  const second = movementParts.length
    ? movementParts.join(" ")
    : "There were no saved trades or free-agent signings significant enough to define the league's offseason story.";

  const conference = conferenceDisplayName(conferenceNameOf(context.team));
  const rivals = context.conferenceCompetition.slice(0, 3);
  const third = rivals.length
    ? `${conference} competition has also changed. ${rivals.map((row) => row.headline).join(" ")}`
    : `${conference} results will be the clearest early measure of where the team stands.`;
  return [first, second, third];
}


function buildProspectParagraphs(context) {
  const { canonical, draft, firstRoundPicks, snapshot, recentRookieRows } = context;
  const market = teamMarketName(canonical);
  const boardNames = draft.rows.slice(0, 5).map((row) => `${row.name} (${row.position}, ${row.overall}/${row.potential})`);
  const first = draft.rows.length
    ? `The ${draft.draftYear} draft class is already available. ${naturalList(boardNames)} currently make up the top group on the saved board.`
    : `The ${draft.draftYear} draft class has not been generated in this save yet.`;
  const ownedLabels = firstRoundPicks.slice(0, 4).map((pick) => {
    const original = draftPickOriginalTeamName(pick);
    return original && normalizeName(original) !== normalizeName(canonical)
      ? `${original}'s first-round pick`
      : "its own first-round pick";
  });
  const capital = firstRoundPicks.length === 0
    ? `${market} does not currently control a listed first-round pick in ${draft.draftYear}.`
    : `${market} currently controls ${firstRoundPicks.length} listed first-round pick${firstRoundPicks.length === 1 ? "" : "s"} in ${draft.draftYear}${ownedLabels.length ? `, including ${naturalList(ownedLabels)}` : ""}.`;
  const second = `${capital} The weakest position on the current depth chart is ${positionNeed(snapshot)}.`;
  const recent = recentRookieRows.length
    ? `${naturalList(recentRookieRows.map((row) => `${row.name} (${row.ovr} OVR, ${row.pot} POT)`))} ${recentRookieRows.length === 1 ? "is" : "are"} the newest young ${recentRookieRows.length === 1 ? "player" : "players"} already on the roster.`
    : "There is no clearly tagged recent rookie in the current roster data.";
  const externalPickStories = (context.externalPickIntel?.groups || []).slice(0, 2).map((row) => row.headline);
  const lineage = context.pickLineage?.find((row) => row.outcome)?.headline || "";
  return [first, second, recent, ...externalPickStories, lineage].filter(Boolean);
}


function buildOutlookParagraphs(context) {
  const { canonical, snapshot, previousRow, futureFirsts, expiringTradeTargets, extensionWatch, ownExpiringWatch } = context;
  const market = teamMarketName(canonical);
  const core = snapshot.top.slice(0, 3).map((row) => `${row.name} (${row.ovr} OVR${row.age ? `, age ${row.age}` : ""})`);
  const first = `${market} enters ${seasonLabel(context.seasonYear)} with ${naturalList(core) || "an unsettled core"}.${previousRow ? ` Last season ended at ${formatRecord(previousRow)} with the team ${formatFinish(previousRow)}.` : ""} ${context.franchiseDirection?.summary || ""}`.trim();

  const decisions = [];
  if (extensionWatch.length) decisions.push(`${extensionWatch.length} extension decision${extensionWatch.length === 1 ? " is" : "s are"} already approaching`);
  const nonExtensionExpirings = ownExpiringWatch.filter((row) => !extensionWatch.some((ext) => normalizeName(ext.name) === normalizeName(row.name)));
  if (nonExtensionExpirings.length) decisions.push(`${naturalList(nonExtensionExpirings.slice(0, 2).map((row) => row.name))} can reach free agency after the season`);
  if (context.moodPulse?.average < 60) decisions.push("the locker room starts the year with some real frustration");
  const capital = context.externalPickIntel?.portfolioSummary
    || `${market} controls ${futureFirsts} listed first-round pick${futureFirsts === 1 ? "" : "s"} over the next four drafts.`;
  const marketTargets = expiringTradeTargets.length
    ? ` The current market list also includes ${expiringTradeTargets.length} realistic expiring-contract trade target${expiringTradeTargets.length === 1 ? "" : "s"}.`
    : "";
  const second = `${decisions.length ? `The front office also has to manage ${naturalList(decisions)}.` : "There is no single contract or locker-room issue dominating the start of the year."} ${capital}${marketTargets}`.trim();

  const lineage = context.assetHighlights?.find((row) => row.type === "pick_lineage")?.headline || "";
  const third = `${lineage ? `${lineage} ` : ""}${context.primaryStoryline.statement} The next moves should match that direction instead of pulling the roster in two different directions.`.trim();
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
    const openingSnapshot = rosterSnapshot(team);
    const externalPickIntel = buildExternalFirstRoundPickIntel({
      leagueData,
      teamName: canonical,
      seasonYear,
      previousEntry: null,
      direction: openingSnapshot.direction,
    });
    const y1ProspectPickStories = externalPickIntel.groups.slice(0, 2).map((row) => row.headline);
    const y1OutlookPickStory = externalPickIntel.portfolioSummary;
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
        prospects: {
          ...firstSeason.prospects,
          paragraphs: [...(firstSeason.prospects?.paragraphs || []), ...y1ProspectPickStories],
          prospects:prospectRows,
          classCount:draft.classCount,
          draftYear:draft.draftYear,
        },
        outlook: {
          ...firstSeason.outlook,
          paragraphs: [...(firstSeason.outlook?.paragraphs || []), ...(y1OutlookPickStory ? [y1OutlookPickStory] : [])],
        },
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
  const recentTradeTimeline = buildTeamTradeTimeline(leagueData, canonical, seasonYear, { lookback: 1 });
  const historicalTradeTimeline = allTeamTradeTimeline(leagueData, canonical, seasonYear, 8);

  const context = {
    leagueData, seasonYear, canonical, team, previousEntry, previousRow, snapshot,
    progressionRows, progression, teamProgression:teamProgressionRows,
    leagueBoard, activity, previousStats, turnover, draft, firstRoundPicks, futureFirsts,
    recentRookieRows, extensionWatch, ownExpiringWatch, expiringTradeTargets, moodPulse,
    recentTradeTimeline, historicalTradeTimeline,
  };
  context.tradeLedger = buildTradeAssetLedger({
    leagueData,
    teamName: canonical,
    seasonYear,
    previousEntry,
    timeline: recentTradeTimeline,
  });
  context.franchiseDirection = buildFranchiseDirection(context);
  context.externalPickIntel = buildExternalFirstRoundPickIntel({
    leagueData,
    teamName: canonical,
    seasonYear,
    previousEntry,
    direction: context.franchiseDirection?.type || snapshot.direction,
  });
  context.majorTradeNarratives = buildMajorTradeNarratives(context);
  context.transactionStories = buildTeamTransactionStories(context);
  context.tradePartnerAftermath = buildTradePartnerAftermath(context);
  context.pickLineage = buildPickLineage(context);
  context.assetHighlights = buildHistoricalAssetHighlights(context);
  context.conferenceCompetition = buildConferenceCompetition(context);
  const prior = previousStoredSnapshot(leagueData, canonical, seasonYear);
  const story = primaryStoryline(context);
  context.primaryStoryline = story;
  context.continuity = continuityAssessment(prior, context);

  const dossier = {
    version: 6,
    generatedFrom: "transaction_asset_lineage_direction_partner_aftermath",
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
    franchiseDirection: context.franchiseDirection,
    externalPickIntel: {
      count: context.externalPickIntel?.count || 0,
      teamCount: context.externalPickIntel?.teamCount || 0,
      portfolioSummary: context.externalPickIntel?.portfolioSummary || "",
      groups: (context.externalPickIntel?.groups || []).slice(0, 4).map((row) => ({
        externalTeam: row.externalTeam,
        state: row.state,
        previousRecord: row.previousRecord,
        previousFinish: row.previousFinish,
        rosterDirection: row.rosterDirection,
        rosterAverage: row.rosterAverage,
        rosterAverageAge: row.rosterAverageAge,
        topPlayer: row.topPlayer,
        headline: row.headline,
        assets: row.assets.slice(0, 4).map((asset) => ({
          id: asset.id, year: asset.year, assetType: asset.assetType, originalTeam: asset.originalTeam,
          externalTeam: asset.externalTeam, protection: asset.protection, swapWithTeam: asset.swapWithTeam,
        })),
      })),
    },
    tradeLedger: {
      firstsIn: context.tradeLedger.firstsIn,
      firstsOut: context.tradeLedger.firstsOut,
      netFirsts: context.tradeLedger.netFirsts,
      secondsIn: context.tradeLedger.secondsIn,
      secondsOut: context.tradeLedger.secondsOut,
      swapsIn: context.tradeLedger.swapsIn,
      swapsOut: context.tradeLedger.swapsOut,
      salaryDelta: context.tradeLedger.salaryDelta,
      rootOutgoingPlayers: context.tradeLedger.rootOutgoingPlayers.slice(0, 4).map((row) => ({ playerName:row.playerName, overall:row.overall, partnerTeam:row.partnerTeam, date:row.date })),
      retainedIncomingPlayers: context.tradeLedger.retainedIncomingPlayers.slice(0, 4).map((row) => ({ playerName:row.playerName, overall:row.overall, partnerTeam:row.partnerTeam, date:row.date })),
      bridges: context.tradeLedger.bridges.slice(0, 4).map((row) => ({ playerName:row.playerName, overall:row.overall, acquiredFrom:row.acquiredFrom, movedTo:row.movedTo, games:row.games, days:row.days })),
    },
    tradePartnerAftermath: context.tradePartnerAftermath.slice(0, 4).map((row) => ({ playerName:row.playerName, destination:row.destination, overall:row.overall, headline:row.headline })),
    pickLineage: context.pickLineage.slice(0, 8).map((row) => ({
      year:row.pick?.year || 0,
      originalTeam:row.pick?.originalTeam || "",
      anchorPlayer:row.anchorPlayer || "",
      draftedPlayer:row.outcome?.playerName || "",
      pickNumber:row.outcome?.pick || 0,
      headline:row.headline,
    })),
    assetHighlights: context.assetHighlights.slice(0, 5).map((row) => ({ type:row.type, score:row.score, headline:row.headline })),
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
    source: "event_dossier_v7",
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
