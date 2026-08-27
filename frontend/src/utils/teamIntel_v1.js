// src/utils/teamIntel_v1.js
// Fast, read-only 2K-style Team Intel engine.
// Runs only on the Intel page, uses memoized local JS data, and never touches sim loops.

import LZString from "lz-string";
import { computeTeamRatings } from "../api/teamRatings.js";
import { GAMEPLAN_VERSION, buildSmartRotation } from "./ensureGameplans";
import {
  getAllTeamsFromLeague,
  normalizeDraftPicks,
  normalizeTeamName,
  sortDraftPickAssets,
} from "./draftPicks.js";
import { getContractSeasonYear } from "./seasonContext.js";
import { readScheduleFromStorage } from "./scheduleStorage.js";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const POWER_RANKINGS_AUTO_RATINGS_CACHE_KEY = "bm_power_rankings_auto_ratings_v5";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const POSITION_LABELS = ["PG", "SG", "SF", "PF", "C", "6TH"];
const DEFAULT_SALARY_CAP = 141_000_000;
const DEFAULT_PICK_PROTECTION = "Unprotected";

const PHASE_LABELS = {
  contending: "Contending",
  retooling: "Retooling",
  rebuilding: "Rebuilding",
};

const PHASE_SUMMARIES = {
  contending:
    "Top-six conference power team. Their front office should buy without exposing the star core.",
  retooling:
    "Middle conference power team. They should fix the roster shape without fully bottoming out.",
  rebuilding:
    "Bottom conference power team. Picks, youth, cap flexibility, and timeline fit matter more than wins now.",
};

const PHASE_PREFERENCES = {
  contending: { currentTalent: 1.24, upside: 0.66, picks: 0.8, salaryFlex: 0.78 },
  retooling: { currentTalent: 0.98, upside: 1.1, picks: 1.02, salaryFlex: 1.02 },
  rebuilding: { currentTalent: 0.72, upside: 1.45, picks: 1.26, salaryFlex: 1.18 },
};

export function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function teamNameOf(team) {
  return String(team?.name || team?.teamName || team?.team || "").trim();
}

export function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

export function teamLogoOf(team) {
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

export function playerHeadshotOf(player) {
  return (
    player?.headshot ||
    player?.headshotUrl ||
    player?.photoUrl ||
    player?.portrait ||
    player?.image ||
    player?.img ||
    ""
  );
}

export function formatMoney(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

function parseMaybeCompressed(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    if (String(raw).startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(String(raw).slice(3));
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

function safeLocalStorageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSchedule() {
  return readScheduleFromStorage();
}

function resultV3Key(gameId) {
  return `${RESULT_V3_PREFIX}${gameId}`;
}

function loadResultsV3() {
  const ids = parseMaybeCompressed(safeLocalStorageGet(RESULT_V3_INDEX_KEY), []) || [];
  const out = {};
  for (const id of ids) {
    const result = parseMaybeCompressed(safeLocalStorageGet(resultV3Key(id)), null);
    if (result) out[String(id)] = result;
  }
  return out;
}

export function getCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

function normalizeConference(raw) {
  const text = String(raw || "").toLowerCase();
  if (text.includes("east")) return "East";
  if (text.includes("west")) return "West";
  return raw || "";
}

function getTeamConferenceMap(leagueData, teams) {
  const map = {};
  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    for (const [conf, arr] of Object.entries(leagueData.conferences)) {
      for (const team of arr || []) {
        const name = teamNameOf(team);
        if (name) map[name] = normalizeConference(conf);
      }
    }
  }
  for (const team of teams || []) {
    const name = teamNameOf(team);
    if (!name) continue;
    if (!map[name]) map[name] = normalizeConference(team?.conference || team?.conf || team?.divisionConference || "");
  }
  return map;
}

export function buildRecordMap(teams = []) {
  const schedule = loadSchedule();
  const results = loadResultsV3();
  const map = {};

  const ensure = (teamName) => {
    if (!teamName) return null;
    if (!map[teamName]) map[teamName] = { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    return map[teamName];
  };

  for (const team of teams || []) ensure(teamNameOf(team));

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.id) continue;
      const result = results?.[String(game.id)];
      if (!game.played && !result) continue;
      const homePts = toNum(result?.totals?.home ?? result?.winner?.home, NaN);
      const awayPts = toNum(result?.totals?.away ?? result?.winner?.away, NaN);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts) || homePts === awayPts) continue;

      const home = ensure(game.home);
      const away = ensure(game.away);
      if (!home || !away) continue;

      home.gp += 1;
      away.gp += 1;
      home.pf += homePts;
      home.pa += awayPts;
      away.pf += awayPts;
      away.pa += homePts;

      if (homePts > awayPts) {
        home.w += 1;
        away.l += 1;
      } else {
        away.w += 1;
        home.l += 1;
      }
    }
  }
  return map;
}

function readSavedGameplanMinutes(teamName) {
  if (!teamName) return null;
  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.minutes && typeof parsed.minutes === "object" && !Array.isArray(parsed.minutes)) {
      return { ...parsed.minutes };
    }
    return { ...parsed };
  } catch {
    return null;
  }
}


function getLegacyGameplanRosterSignature(teamPlayers = []) {
  return [...(teamPlayers || [])]
    .map((p) => [p.name || "", p.pos || "", p.secondaryPos || "", p.overall || 0].join("|"))
    .sort()
    .join("||");
}

function getPowerRankingsRosterSignature(teamPlayers = []) {
  return [
    `auto-v${GAMEPLAN_VERSION}`,
    ...[...(teamPlayers || [])]
      .map((p) =>
        [
          p.name || p.player || "",
          p.pos || "",
          p.secondaryPos || "",
          toNum(p.overall ?? p.ovr, 0),
          toNum(p.offRating ?? p.off ?? p.offense, 0),
          toNum(p.defRating ?? p.def ?? p.defense, 0),
          toNum(p.stamina, 75),
          toNum(p.potential ?? p.pot, 0),
          toNum(p.age, 0),
        ].join("|")
      )
      .sort(),
  ].join("||");
}

function getRosterNames(teamPlayers = []) {
  return new Set((teamPlayers || []).map((p) => p?.name || p?.player).filter(Boolean));
}

function setsMatch(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function hasValidMinutesMap(minutes, rosterNames) {
  if (!minutes || typeof minutes !== "object" || Array.isArray(minutes)) return false;
  const minuteNames = new Set(Object.keys(minutes));
  if (!setsMatch(rosterNames, minuteNames)) return false;
  for (const name of minuteNames) if (!Number.isFinite(Number(minutes[name]))) return false;
  return true;
}

function readSavedGameplanPayload(teamName) {
  if (!teamName) return null;
  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isUsableSavedAutoGameplan(team, savedPlan) {
  if (!team?.name || !savedPlan || typeof savedPlan !== "object") return false;

  // Match the Power Rankings page: user-edited coach minutes are strategy-only
  // and must not secretly reorder league-wide team strength.
  if (savedPlan.manualLocked || savedPlan.userEdited || savedPlan.source === "coach_gameplan") return false;
  if (savedPlan.version !== GAMEPLAN_VERSION) return false;
  if (savedPlan.teamName !== team.name) return false;
  if (savedPlan.rosterSignature !== getLegacyGameplanRosterSignature(team?.players || [])) return false;
  return hasValidMinutesMap(savedPlan.minutes, getRosterNames(team?.players || []));
}

function readAutoRatingsCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POWER_RANKINGS_AUTO_RATINGS_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAutoRatingsCache(cache) {
  try {
    localStorage.setItem(POWER_RANKINGS_AUTO_RATINGS_CACHE_KEY, JSON.stringify(cache || {}));
  } catch {}
}

function normalizeRatingsForPowerRankings(ratings) {
  return {
    overall: toNum(ratings?.overall, 0),
    off: toNum(ratings?.off, 0),
    def: toNum(ratings?.def, 0),
    exactOverall: toNum(ratings?.exactOverall ?? ratings?.overall, 0),
    exactOff: toNum(ratings?.exactOff ?? ratings?.off, 0),
    exactDef: toNum(ratings?.exactDef ?? ratings?.def, 0),
  };
}

function computeRatingsFromMinutes(team, minutes) {
  return normalizeRatingsForPowerRankings(computeTeamRatings(team, minutes));
}

function buildAutoRebuiltMinutes(team) {
  try {
    const built = buildSmartRotation(team?.players || []);
    if (built?.obj && typeof built.obj === "object") return built.obj;
  } catch (error) {
    console.warn("Team Intel power-rank auto rotation fallback:", error);
  }
  return buildFallbackMinutes(team);
}

function getTeamRatingsForPowerRankings(team, autoRatingsCache, markCacheDirty) {
  const teamName = team?.name || teamNameOf(team);
  const signature = getPowerRankingsRosterSignature(team?.players || []);
  const cached = teamName ? autoRatingsCache?.[teamName] : null;
  if (cached?.signature === signature) return normalizeRatingsForPowerRankings(cached);

  const savedPlan = readSavedGameplanPayload(teamName);
  const minutes = isUsableSavedAutoGameplan(team, savedPlan) ? savedPlan.minutes : buildAutoRebuiltMinutes(team);
  const ratings = computeRatingsFromMinutes(team, minutes);

  if (teamName && autoRatingsCache) {
    autoRatingsCache[teamName] = { signature, ...ratings };
    markCacheDirty?.();
  }
  return ratings;
}

function buildFallbackMinutes(team) {
  const players = [...(team?.players || [])]
    .filter((p) => p?.name || p?.player)
    .sort((a, b) => playerOverall(b) - playerOverall(a));
  const minuteSlots = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];
  const minutes = {};
  for (let i = 0; i < Math.min(players.length, minuteSlots.length); i += 1) {
    const name = playerNameOf(players[i]);
    if (name) minutes[name] = minuteSlots[i];
  }
  return minutes;
}

function getRotationMinutes(team) {
  return readSavedGameplanMinutes(teamNameOf(team)) || buildFallbackMinutes(team);
}

function computeSafeTeamRatings(team) {
  try {
    const ratings = getTeamRatingsForPowerRankings(team, readAutoRatingsCache(), null);
    return {
      overall: toNum(ratings?.overall, 0),
      off: toNum(ratings?.off, 0),
      def: toNum(ratings?.def, 0),
      exactOverall: toNum(ratings?.exactOverall, ratings?.overall || 0),
      exactOff: toNum(ratings?.exactOff, ratings?.off || 0),
      exactDef: toNum(ratings?.exactDef, ratings?.def || 0),
    };
  } catch {
    const top = getStandardPlayers(team)
      .map((p) => playerOverall(p))
      .sort((a, b) => b - a)
      .slice(0, 8);
    const fallback = top.length ? top.reduce((sum, value) => sum + value, 0) / top.length : 0;
    return {
      overall: Math.round(fallback),
      off: Math.round(fallback),
      def: Math.round(fallback),
      exactOverall: fallback,
      exactOff: fallback,
      exactDef: fallback,
    };
  }
}

export function getStandardPlayers(team) {
  return Array.isArray(team?.players) ? team.players.filter(isTradeableStandardPlayer) : [];
}

export function playerOverall(player) {
  return toNum(player?.overall ?? player?.ovr ?? player?.rating ?? player?.overallRating, 60);
}

export function playerPotential(player) {
  return toNum(player?.potential ?? player?.pot, playerOverall(player));
}

export function playerAge(player) {
  return toNum(player?.age, 27);
}

function isTradeableStandardPlayer(player) {
  const status = String(player?.rosterStatus || player?.contractType || "").toLowerCase();
  return !(
    player?.isTwoWay ||
    player?.isStash ||
    status.includes("two_way") ||
    status.includes("two-way") ||
    status.includes("stash") ||
    status.includes("stashed")
  );
}

function average(values, fallback = 0) {
  const rows = values.filter((v) => Number.isFinite(Number(v)));
  if (!rows.length) return fallback;
  return rows.reduce((sum, value) => sum + Number(value), 0) / rows.length;
}

function averageTopOverall(team, count = 8) {
  const top = getStandardPlayers(team)
    .map(playerOverall)
    .sort((a, b) => b - a)
    .slice(0, count);
  return average(top, 0);
}

function averageRosterAge(team) {
  return average(getStandardPlayers(team).map(playerAge), 27);
}

export function getPlayerSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (salaries.length) {
    const payrollSeasonYear = getContractSeasonYear(leagueData || {});
    const startYear = Number(contract.startYear || payrollSeasonYear);
    let idx = payrollSeasonYear - startYear;
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (idx >= salaries.length) idx = salaries.length - 1;
    return Number(salaries[idx] || 0);
  }
  const fallback = Number(
    player?.salary ?? player?.currentSalary ?? player?.contractSalary ?? player?.capHit ?? player?.aav ?? 0
  );
  return Number.isFinite(fallback) ? fallback : 0;
}

function getSalaryCap(leagueData) {
  const rules = leagueData?.financialRules || leagueData?.salaryRules || leagueData?.rules || {};
  return toNum(leagueData?.salaryCap ?? leagueData?.capLimit ?? rules.salaryCap ?? rules.capLimit, DEFAULT_SALARY_CAP);
}

function teamPayroll(team, leagueData) {
  return getStandardPlayers(team).reduce((sum, player) => sum + getPlayerSalary(player, leagueData), 0);
}

function contractYearsLeft(player, leagueData) {
  const direct = toNum(player?.yearsLeft ?? player?.contractYears, -1);
  if (direct >= 0) return Math.round(direct);
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;
  const payrollSeasonYear = getContractSeasonYear(leagueData || {});
  const startYear = Number(contract.startYear || payrollSeasonYear);
  let idx = payrollSeasonYear - startYear;
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= salaries.length) idx = salaries.length - 1;
  return Math.max(1, salaries.length - idx);
}

function isExpiring(player, leagueData) {
  return contractYearsLeft(player, leagueData) <= 1 && getPlayerSalary(player, leagueData) > 0;
}

function buildPowerRows(leagueData, teams, records, ratingsByTeam) {
  const confMap = getTeamConferenceMap(leagueData, teams);
  const baseRows = teams.map((team) => {
    const name = teamNameOf(team);
    const record = records[name] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    const gp = toNum(record.gp, 0);
    const ratings = ratingsByTeam[name] || computeSafeTeamRatings(team);
    return {
      team,
      name,
      conference: confMap[name] || "",
      ratings,
      w: toNum(record.w, 0),
      l: toNum(record.l, 0),
      gp,
      winPct: gp > 0 ? toNum(record.w, 0) / gp : 0,
      pointDiff: gp > 0 ? (toNum(record.pf, 0) - toNum(record.pa, 0)) / gp : 0,
    };
  });

  const useRecordPowerRankings = baseRows.length > 0 && baseRows.every((row) => row.gp >= 20);
  const scored = baseRows.map((row) => {
    const recordScore = row.winPct * 100;
    const powerScore = useRecordPowerRankings
      ? row.ratings.exactOverall * 0.5 + recordScore * 0.5
      : row.ratings.exactOverall;
    return { ...row, recordScore, powerScore, useRecordPowerRankings };
  });

  scored.sort(
    (a, b) =>
      b.powerScore - a.powerScore ||
      (useRecordPowerRankings ? b.winPct - a.winPct : 0) ||
      b.ratings.exactOverall - a.ratings.exactOverall ||
      b.pointDiff - a.pointDiff ||
      b.w - a.w ||
      a.name.localeCompare(b.name)
  );

  const globalRanked = scored.map((row, idx) => ({ ...row, powerRank: idx + 1 }));
  const byName = {};
  for (const row of globalRanked) byName[normalizeTeamName(row.name)] = row;

  for (const conf of ["East", "West"]) {
    const confRows = globalRanked
      .filter((row) => normalizeConference(row.conference) === conf)
      .sort((a, b) => a.powerRank - b.powerRank);
    confRows.forEach((row, idx) => {
      byName[normalizeTeamName(row.name)].conferenceRank = idx + 1;
      byName[normalizeTeamName(row.name)].conferenceTeamCount = confRows.length;
    });
  }

  return globalRanked.map((row) => byName[normalizeTeamName(row.name)] || row);
}

function phaseFromConferenceRank(rank) {
  if (rank <= 6) return "contending";
  if (rank <= 11) return "retooling";
  return "rebuilding";
}

function getPositionScores(team) {
  const scores = Object.fromEntries(POSITIONS.map((pos) => [pos, 0]));
  for (const player of getStandardPlayers(team)) {
    const overall = playerOverall(player);
    const primary = player?.pos;
    const secondary = player?.secondaryPos;
    if (scores[primary] !== undefined) scores[primary] = Math.max(scores[primary], overall);
    if (scores[secondary] !== undefined) scores[secondary] = Math.max(scores[secondary], overall * 0.78);
  }
  return scores;
}

function topRotation(team, count = 8) {
  return getStandardPlayers(team)
    .sort((a, b) => playerOverall(b) - playerOverall(a))
    .slice(0, count);
}



// BM_PATCH38_TEAM_INTEL_REALISM_HELPERS
// Shared front-office interpretation helpers for the deflated OVR scale.
function teamIntelPlayerKey(player = {}) {
  return normalizeTeamName(playerNameOf(player) || player?.id || player?.playerId || "");
}

function getMinutesForPlayer(minutes = {}, player = {}) {
  const candidates = [playerNameOf(player), player?.name, player?.player, player?.id, player?.playerId]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(String);
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(minutes || {}, key)) return toNum(minutes[key], 0);
  }
  const normalized = Object.fromEntries(Object.entries(minutes || {}).map(([key, value]) => [normalizeTeamName(key), value]));
  for (const key of candidates) {
    const normalizedKey = normalizeTeamName(key);
    if (Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) return toNum(normalized[normalizedKey], 0);
  }
  return 0;
}

function getOrderedRotationPlayers(team) {
  const players = getStandardPlayers(team);
  const byKey = new Map(players.map((player) => [teamIntelPlayerKey(player), player]));
  const used = new Set();
  const out = [];
  const minutes = getRotationMinutes(team) || {};
  const saved = readSavedGameplanPayload(teamNameOf(team));
  const order = Array.isArray(saved?.order) ? saved.order : [];

  for (const rawName of order) {
    const key = normalizeTeamName(rawName);
    const player = byKey.get(key);
    if (player && !used.has(key)) {
      out.push(player);
      used.add(key);
    }
  }

  for (const player of [...players].sort((a, b) =>
    getMinutesForPlayer(minutes, b) - getMinutesForPlayer(minutes, a) ||
    playerOverall(b) - playerOverall(a) ||
    playerPotential(b) - playerPotential(a) ||
    playerAge(a) - playerAge(b) ||
    playerNameOf(a).localeCompare(playerNameOf(b))
  )) {
    const key = teamIntelPlayerKey(player);
    if (!used.has(key)) {
      out.push(player);
      used.add(key);
    }
  }
  return out;
}

function playerEligibleAt(player, pos) {
  return player?.pos === pos || player?.secondaryPos === pos;
}

function playerRoleRanks(team, player, minutes = null) {
  const roster = getStandardPlayers(team);
  const key = teamIntelPlayerKey(player);
  const byOverall = [...roster].sort((a, b) =>
    playerOverall(b) - playerOverall(a) ||
    playerPotential(b) - playerPotential(a) ||
    playerAge(a) - playerAge(b) ||
    playerNameOf(a).localeCompare(playerNameOf(b))
  );
  const mins = minutes || getRotationMinutes(team) || {};
  const byMinutes = [...roster].sort((a, b) =>
    getMinutesForPlayer(mins, b) - getMinutesForPlayer(mins, a) ||
    playerOverall(b) - playerOverall(a) ||
    playerNameOf(a).localeCompare(playerNameOf(b))
  );
  return {
    overallRank: Math.max(1, byOverall.findIndex((row) => teamIntelPlayerKey(row) === key) + 1 || roster.length + 1),
    rotationRank: Math.max(1, byMinutes.findIndex((row) => teamIntelPlayerKey(row) === key) + 1 || roster.length + 1),
    mpg: getMinutesForPlayer(mins, player),
  };
}

function sourceRosterTopCutoff(phase) {
  if (phase === "contending") return 5;
  if (phase === "retooling") return 4;
  return 3;
}

function isStrongNeedFit(player, needs = []) {
  return (needs || []).some((need) => playerTraitMatchesNeed(player, need) >= 11);
}

function playerNeedFitLabel(player, needs = []) {
  const matched = (needs || [])
    .map((need) => ({ need, score: playerTraitMatchesNeed(player, need) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  return matched?.need?.label || "roster fit";
}

function isProtectedCorePlayer(team, player, phase, leagueData = null, needs = []) {
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const upside = potential - overall;
  const minutes = getRotationMinutes(team) || {};
  const ranks = playerRoleRanks(team, player, minutes);
  const mpg = ranks.mpg;
  const highMinute = mpg >= 28;
  const realRotation = mpg >= 20;
  const needFit = isStrongNeedFit(player, needs);

  const isMegaStar = overall >= 89;
  const isPrimeYoungStar = age <= 26 && overall >= 84 && potential >= 88;
  const isYoungTitleCore = phase === "contending" && age <= 25 && overall >= 80 && potential >= 86 && ranks.overallRank <= 4;
  const isEliteFuture = age <= 21 && potential >= 92 && overall >= 74;
  const isBlueChipFuture = age <= 22 && potential >= 90 && overall >= 76;
  const isContendingPrimeStar = phase === "contending" && age <= 30 && overall >= 86 && ranks.overallRank <= 3;
  const isContendingVetStar = phase === "contending" && age >= 31 && overall >= 87 && ranks.overallRank <= 2;

  // Visible untouchables should be true franchise/core names, not every good young player.
  // This prevents Coward/Ware/Giddey/Matas/Miller/Reaves/Lauri/Zion/Kyrie/AD/Dame-style
  // players from being labeled untouchable just because they are useful or high OVR.
  if (phase === "contending") {
    if (isMegaStar && ranks.overallRank <= 2) return { protected: true, visible: true, level: "franchise", label: "Franchise anchor", score: 130 };
    if (isPrimeYoungStar && ranks.overallRank <= 4) return { protected: true, visible: true, level: "young_star", label: "Young title core", score: 124 - ranks.overallRank };
    if (isContendingPrimeStar) return { protected: true, visible: true, level: "prime_star", label: "Prime title piece", score: 116 - ranks.overallRank };
    if (isContendingVetStar) return { protected: true, visible: true, level: "veteran_star", label: "Veteran title anchor", score: 108 - ranks.overallRank };
    if (isBlueChipFuture && ranks.overallRank <= 5) return { protected: true, visible: true, level: "bluechip", label: "Blue-chip title core", score: 105 - ranks.overallRank };

    if (ranks.overallRank <= 3 && (overall >= 80 || highMinute)) return { protected: true, visible: false, level: "title_core", label: "Protected title core", score: 96 - ranks.overallRank };
    if (isYoungTitleCore) return { protected: true, visible: false, level: "young_core", label: "Protected young title core", score: 92 - ranks.overallRank };
    if (needFit && realRotation && overall >= 76 && age <= 29 && ranks.overallRank <= 4) return { protected: true, visible: false, level: "fit_core", label: "Protected lineup fit", score: 82 - ranks.overallRank };
  }

  if (phase === "retooling") {
    if (isMegaStar && age <= 27 && ranks.overallRank <= 2) return { protected: true, visible: true, level: "retool_star", label: "Retool franchise anchor", score: 122 - ranks.overallRank };
    if (isEliteFuture && ranks.overallRank <= 3) return { protected: true, visible: true, level: "elite_future", label: "Elite future core", score: 118 - ranks.overallRank };
    if (isBlueChipFuture && ranks.overallRank <= 2 && potential >= 93) return { protected: true, visible: true, level: "bluechip", label: "Blue-chip prospect", score: 110 - ranks.overallRank };

    if (age <= 24 && overall >= 79 && potential >= 88 && ranks.overallRank <= 3) return { protected: true, visible: false, level: "young_core", label: "Protected young retool core", score: 84 - ranks.overallRank };
    if (age <= 23 && potential >= 88 && upside >= 6 && ranks.overallRank <= 5) return { protected: true, visible: false, level: "upside", label: "Protected upside", score: 78 - ranks.overallRank };
  }

  if (phase === "rebuilding") {
    if (isMegaStar && age <= 24 && ranks.overallRank <= 2) return { protected: true, visible: true, level: "rebuild_star", label: "Rebuild franchise anchor", score: 122 - ranks.overallRank };
    if (isEliteFuture && ranks.overallRank <= 4) return { protected: true, visible: true, level: "elite_future", label: "Elite future core", score: 116 - ranks.overallRank };
    if (isBlueChipFuture && potential >= 94 && ranks.overallRank <= 4) return { protected: true, visible: true, level: "bluechip", label: "Franchise prospect", score: 112 - ranks.overallRank };

    if (age <= 24 && overall >= 78 && potential >= 89 && ranks.overallRank <= 3) return { protected: true, visible: false, level: "young_core", label: "Protected young rebuild core", score: 84 - ranks.overallRank };
    if (age <= 22 && potential >= 88 && upside >= 7 && ranks.overallRank <= 5) return { protected: true, visible: false, level: "upside", label: "Protected upside", score: 76 - ranks.overallRank };
  }

  return { protected: false, visible: false, level: "available", label: "Available in right context", score: 0 };
}

function sourceAvailabilityForTarget(sourceTeam, player, sourcePhase, sourceShell = {}, leagueData = null) {
  const sourceRatings = sourceShell?.powerRow?.ratings || computeSafeTeamRatings(sourceTeam);
  const sourceNeeds = buildNeeds(sourceTeam, sourcePhase, sourceRatings);
  const protection = isProtectedCorePlayer(sourceTeam, player, sourcePhase, leagueData, sourceNeeds);
  if (protection.protected) return { ok: false, score: -999, reason: protection.label, maxUses: 0 };

  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const upside = potential - overall;
  const salary = getPlayerSalary(player, leagueData);
  const minutes = getRotationMinutes(sourceTeam) || {};
  const ranks = playerRoleRanks(sourceTeam, player, minutes);
  const crowding = positionalCrowding(player, sourceTeam);
  const expiring = isExpiring(player, leagueData);
  const reasons = [];
  let score = 0;

  if (sourcePhase === "contending") {
    if (ranks.overallRank <= 3 || (overall >= 84 && ranks.overallRank <= 5)) return { ok: false, score: -999, reason: "protected title core", maxUses: 0 };
    if (age >= 30 && overall >= 70) { score += 23; reasons.push("older contender piece"); }
    if (salary >= 15_000_000 && overall <= 80) { score += 20; reasons.push("salary-match piece"); }
    if (ranks.rotationRank >= 7 && overall >= 68) { score += 17; reasons.push("rotation squeeze"); }
    if (ranks.mpg > 0 && ranks.mpg < 22 && overall >= 68) { score += 14; reasons.push("could play more elsewhere"); }
    if (age <= 23 && upside >= 5 && ranks.mpg < 18) { score += 16; reasons.push("blocked young player"); }
    if (crowding > 0 && ranks.rotationRank >= 6) { score += crowding * 6; reasons.push("position overload"); }
    if (ranks.mpg >= 28 && age < 30 && overall >= 76) score -= 20;
  } else if (sourcePhase === "retooling") {
    if (age <= 24 && potential >= 89 && overall >= 78 && ranks.overallRank <= 3) return { ok: false, score: -999, reason: "protected young retool core", maxUses: 0 };
    if (age >= 28 && overall >= 72) { score += 23; reasons.push("older retool piece"); }
    if (salary >= 18_000_000 && overall <= 82) { score += 17; reasons.push("salary cleanup"); }
    if (ranks.rotationRank >= 7 && overall >= 68) { score += 14; reasons.push("rotation squeeze"); }
    if (ranks.mpg > 0 && ranks.mpg < 20 && overall >= 68) { score += 12; reasons.push("underused rotation player"); }
    if (age <= 24 && upside >= 5 && ranks.mpg < 16) { score += 12; reasons.push("blocked prospect"); }
    if (expiring && age >= 27) { score += 11; reasons.push("expiring veteran"); }
    if (crowding > 0) { score += crowding * 5; reasons.push("position overload"); }
    if (age <= 25 && potential >= 86 && ranks.overallRank <= 4) score -= 16;
  } else {
    if (age <= 22 && potential >= 90 && overall >= 74) return { ok: false, score: -999, reason: "elite rebuild future", maxUses: 0 };
    if (age >= 26 && overall >= 70) { score += 30; reasons.push("veteran outside rebuild timeline"); }
    if (age >= 30) { score += 9; reasons.push("age/timeline seller"); }
    if (expiring && age >= 26) { score += 12; reasons.push("expiring veteran"); }
    if (salary >= 12_000_000 && overall <= 82) { score += 12; reasons.push("salary flexibility"); }
    if (potential <= overall + 2 && age >= 25) { score += 9; reasons.push("limited upside"); }
    if (ranks.rotationRank >= 7 && overall >= 68) { score += 8; reasons.push("role squeeze"); }
  }

  const ok = score >= (sourcePhase === "contending" ? 15 : 13);
  return {
    ok,
    score,
    reason: reasons.slice(0, 2).join(" / ") || "available in right offer",
    maxUses: 3,
  };
}

function attrAvg(players, index, fallback = 70) {
  return average(players.map((player) => Number(player?.attrs?.[index])), fallback);
}


function buildNeeds(team, phase, ratings) {
  const top8 = topRotation(team, 8);
  const posScores = getPositionScores(team);
  const needs = [];
  const pushNeed = (key, label, priority, detail, pos = "") => {
    if (!needs.some((need) => need.key === key && need.pos === pos)) needs.push({ key, label, priority, detail, pos });
  };

  const posThreshold = phase === "contending" ? 77 : phase === "retooling" ? 74 : 71;
  const weakestPositions = POSITIONS
    .map((pos) => ({ pos, score: posScores[pos] || 0 }))
    .sort((a, b) => a.score - b.score);

  for (const row of weakestPositions.slice(0, 2)) {
    if (row.score < posThreshold) {
      const label = row.pos === "PG" ? "Lead guard" : row.pos === "C" ? "Center / rim protector" : `${row.pos} upgrade`;
      pushNeed(`pos_${row.pos}`, label, Math.max(8, 91 - row.score), `${row.pos} top option is ${Math.round(row.score)} OVR.`, row.pos);
    }
  }

  const shooting = attrAvg(top8, 0, 70);
  const passing = attrAvg(top8, 5, 70);
  const ball = attrAvg(top8, 4, 70);
  const perD = attrAvg(top8, 8, 70);
  const insD = attrAvg(top8, 9, 70);
  const reb = attrAvg(top8, 12, 70);
  const eighth = playerOverall(topRotation(team, 8)[7] || {});

  if (shooting < 74) pushNeed("shooting", "Shooting / spacing", 14, `Top rotation 3PT avg is ${Math.round(shooting)}.`);
  if (phase !== "rebuilding" && (passing < 73 || ball < 73)) pushNeed("creation", "Secondary creator", 12, "Needs more ball handling and passing.");
  if (perD < 74) pushNeed("perimeter_defense", "Point-of-attack defense", 11, `Perimeter defense avg is ${Math.round(perD)}.`);
  if (insD < 74 || reb < 74) pushNeed("interior_defense", "Interior defense / rebounding", 10, "Frontcourt defense or boards are light.", "C");
  if (eighth && eighth < 70 && phase === "contending") pushNeed("depth", "Bench depth", 9, `8th man is around ${Math.round(eighth)} OVR.`);
  if (phase === "rebuilding") {
    pushNeed("picks", "Draft capital", 16, "Future-focused team should stockpile picks.");
    pushNeed("young_upside", "Young upside", 15, "Timeline needs prospects more than older vets.");
  }
  if (phase === "contending" && toNum(ratings?.overall, 0) < 84) pushNeed("star", "Top-end talent", 13, "Good team, but short one premium piece.");

  return needs.sort((a, b) => b.priority - a.priority).slice(0, 5);
}


function getUntouchableStatus(player, phase, team = null, leagueData = null, needs = []) {
  if (team) {
    const status = isProtectedCorePlayer(team, player, phase, leagueData, needs);
    if (status.protected && status.visible) return status;
    return null;
  }
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const upside = potential - overall;
  if (phase === "contending") {
    if (overall >= 88) return { level: "franchise", label: "Franchise star" };
    if (overall >= 84 && age >= 24 && age <= 32) return { level: "prime", label: "Prime title piece" };
    if (age <= 25 && overall >= 78 && potential >= 84) return { level: "youngcore", label: "Young title-core piece" };
  }
  if (phase === "retooling") {
    if (age >= 29) return null;
    if (age <= 28 && overall >= 80) return { level: "youngcore", label: "Retool core" };
    if (age <= 24 && potential >= 84 && overall >= 74) return { level: "bluechip", label: "Blue-chip prospect" };
  }
  if (phase === "rebuilding") {
    if (age >= 28) return null;
    if (age <= 25 && overall >= 76 && potential >= 82) return { level: "youngstar", label: "Rebuild core" };
    if (age <= 23 && potential >= 82 && upside >= 4) return { level: "future", label: "Protected upside" };
  }
  if (potential >= 88 && age <= 22 && overall >= 72 && upside >= 5) return { level: "bluechip", label: "Protected upside" };
  return null;
}


function isProtectedYoungAsset(player, phase = "retooling") {
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const upside = potential - overall;
  if (age <= 23 && potential >= 84 && overall >= 72) return true;
  if (age <= 24 && potential >= 82 && upside >= 5) return true;
  if (phase === "rebuilding" && age <= 25 && potential >= 80 && overall >= 70) return true;
  return false;
}


function buildUntouchables(team, phase, leagueData = null, needs = []) {
  return getStandardPlayers(team)
    .map((player) => {
      const status = isProtectedCorePlayer(team, player, phase, leagueData, needs);
      const ranks = playerRoleRanks(team, player);
      const score = (status?.score || 0) + playerOverall(player) * 1.2 + Math.max(0, playerPotential(player) - playerOverall(player)) * 1.7 - ranks.overallRank * 2;
      return { player, status, score };
    })
    .filter((row) => row.status?.protected && row.status?.visible)
    .sort(
      (a, b) =>
        playerOverall(b.player) - playerOverall(a.player) ||
        playerPotential(b.player) - playerPotential(a.player) ||
        b.score - a.score ||
        playerAge(a.player) - playerAge(b.player)
    )
    .slice(0, 3)
    .map((row) => decoratePlayer(row.player, { teamName: teamNameOf(team), reason: row.status.label }));
}

function positionalCrowding(player, team) {
  const pos = player?.pos;
  if (!pos) return 0;
  const same = getStandardPlayers(team).filter((row) => row?.pos === pos || row?.secondaryPos === pos);
  const betterOrEqual = same.filter((row) => playerOverall(row) >= playerOverall(player)).length;
  return Math.max(0, betterOrEqual - 2);
}

function decoratePlayer(player, extra = {}) {
  return {
    player,
    name: playerNameOf(player),
    pos: player?.pos || "-",
    secondaryPos: player?.secondaryPos || "",
    overall: playerOverall(player),
    potential: playerPotential(player),
    age: playerAge(player),
    headshot: playerHeadshotOf(player),
    ...extra,
  };
}


function buildLineup(team) {
  const players = getStandardPlayers(team);
  const ordered = getOrderedRotationPlayers(team);
  const minutes = getRotationMinutes(team) || {};
  const candidatePool = ordered.slice(0, Math.min(9, ordered.length));
  let bestMap = null;
  let bestScore = -Infinity;
  const used = new Set();
  const mapping = {};
  const scorePlayerForSlot = (player, pos) => {
    const mpg = getMinutesForPlayer(minutes, player);
    const primary = player?.pos === pos ? 1 : 0;
    const secondary = player?.secondaryPos === pos ? 1 : 0;
    const rotationIndex = Math.max(0, ordered.findIndex((row) => teamIntelPlayerKey(row) === teamIntelPlayerKey(player)));
    return mpg * 900 + playerOverall(player) * 120 + playerPotential(player) * 10 + primary * 1400 + secondary * 900 - rotationIndex * 30;
  };
  const search = (slotIdx, score) => {
    if (slotIdx >= POSITIONS.length) {
      if (score > bestScore) { bestScore = score; bestMap = { ...mapping }; }
      return;
    }
    const pos = POSITIONS[slotIdx];
    const legal = candidatePool.filter((player) => !used.has(teamIntelPlayerKey(player)) && playerEligibleAt(player, pos));
    const fallback = candidatePool.filter((player) => !used.has(teamIntelPlayerKey(player)));
    for (const player of (legal.length ? legal : fallback)) {
      const key = teamIntelPlayerKey(player);
      used.add(key); mapping[pos] = player;
      search(slotIdx + 1, score + scorePlayerForSlot(player, pos));
      delete mapping[pos]; used.delete(key);
    }
  };
  search(0, 0);
  const starterPlayers = bestMap ? POSITIONS.map((pos) => bestMap[pos]).filter(Boolean) : ordered.slice(0, 5);
  const starterKeys = new Set(starterPlayers.map(teamIntelPlayerKey));
  const slots = POSITIONS.map((pos) => ({ label: pos, player: bestMap?.[pos] ? decoratePlayer(bestMap[pos]) : null }));
  const sixth = ordered.find((player) => !starterKeys.has(teamIntelPlayerKey(player))) || players.find((player) => !starterKeys.has(teamIntelPlayerKey(player)));
  slots.push({ label: "6TH", player: sixth ? decoratePlayer(sixth) : null });
  return slots;
}


function buildTradeBlock(team, phase, leagueData, untouchables = [], needs = []) {
  const untouchableNames = new Set(untouchables.map((row) => normalizeTeamName(row.name)));
  const minutes = getRotationMinutes(team) || {};
  return getStandardPlayers(team)
    .map((player) => {
      const name = playerNameOf(player);
      const overall = playerOverall(player);
      const potential = playerPotential(player);
      const age = playerAge(player);
      const upside = potential - overall;
      const salary = getPlayerSalary(player, leagueData);
      const years = contractYearsLeft(player, leagueData);
      const ranks = playerRoleRanks(team, player, minutes);
      const mpg = ranks.mpg;
      const crowding = positionalCrowding(player, team);
      const protection = isProtectedCorePlayer(team, player, phase, leagueData, needs);
      const reasons = [];
      let score = 0;

      if (protection.protected || untouchableNames.has(normalizeTeamName(name))) return null;

      if (phase === "contending") {
        if (ranks.overallRank <= 3 || (overall >= 84 && ranks.overallRank <= 5)) return null;
        if (age >= 30 && overall >= 70) { score += 26; reasons.push("older contender piece"); }
        if (salary >= 15_000_000 && overall <= 80) { score += 23; reasons.push("matching salary"); }
        if (ranks.overallRank >= 5 && overall >= 72) { score += 13; reasons.push("movable non-core rotation"); }
        if (mpg > 0 && mpg < 22 && overall >= 68) { score += 16; reasons.push("could play more elsewhere"); }
        if (age <= 23 && upside >= 5 && mpg < 18) { score += 18; reasons.push("blocked young player"); }
        if (crowding > 0 && ranks.rotationRank >= 6) { score += crowding * 7; reasons.push("position overload"); }
        if (isStrongNeedFit(player, needs) && age < 30 && mpg >= 24) score -= 14;
      } else if (phase === "retooling") {
        if (age >= 28 && overall >= 72) { score += 25; reasons.push("older retool piece"); }
        if (age >= 31 && overall >= 80) { score += 10; reasons.push("star timeline question"); }
        if (mpg > 0 && mpg < 22 && overall >= 68) { score += 15; reasons.push("underused rotation piece"); }
        if (crowding > 0) { score += crowding * 6; reasons.push("position overload"); }
        if (salary >= 18_000_000 && overall <= 82) { score += 15; reasons.push("salary flexibility"); }
        if (years >= 3 && salary >= 14_000_000 && overall < 80) { score += 9; reasons.push("long money"); }
        if (isExpiring(player, leagueData) && age >= 27) { score += 10; reasons.push("expiring veteran"); }
      } else {
        if (age >= 26 && overall >= 70) { score += 31; reasons.push("outside rebuild timeline"); }
        if (age >= 30) { score += 10; reasons.push("veteran seller"); }
        if (salary >= 12_000_000 && overall <= 82) { score += 13; reasons.push("salary flexibility"); }
        if (isExpiring(player, leagueData) && age >= 26) { score += 12; reasons.push("expiring veteran"); }
        if (mpg > 0 && mpg < 20 && overall >= 68) { score += 9; reasons.push("limited role"); }
      }

      if (potential <= overall + 1 && age >= 27 && phase !== "contending") { score += 9; reasons.push("limited upside"); }
      if (age <= 23 && potential >= 90 && phase !== "contending") score -= 18;
      if (!reasons.length || score < 14) return null;

      return decoratePlayer(player, {
        teamName: teamNameOf(team),
        salary,
        mpg,
        score,
        reason: reasons.slice(0, 2).join(" / ") || "available in the right offer",
      });
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.overall || 0) - Number(a.overall || 0) || Number(b.potential || 0) - Number(a.potential || 0) || String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, 12);
}

function playerTraitMatchesNeed(player, need) {
  const pos = player?.pos || "";
  const secondary = player?.secondaryPos || "";
  const attrs = Array.isArray(player?.attrs) ? player.attrs : [];
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);

  if (need.pos && (pos === need.pos || secondary === need.pos)) return 18;
  if (need.key === "shooting") return toNum(attrs[0], 60) >= 76 ? 14 : overall >= 74 ? 6 : 0;
  if (need.key === "creation") return toNum(attrs[4], 60) + toNum(attrs[5], 60) >= 150 ? 13 : overall >= 76 && ["PG", "SG"].includes(pos) ? 7 : 0;
  if (need.key === "perimeter_defense") return toNum(attrs[8], 60) >= 78 ? 12 : overall >= 75 && ["SG", "SF"].includes(pos) ? 6 : 0;
  if (need.key === "interior_defense") return pos === "C" || secondary === "C" || toNum(attrs[9], 60) + toNum(attrs[10], 60) + toNum(attrs[12], 60) >= 224 ? 12 : 0;
  if (need.key === "depth") return overall >= 70 && overall <= 82 ? 11 : 0;
  if (need.key === "young_upside") return age <= 25 && (potential >= overall + 3 || potential >= 80) ? 15 : 0;
  if (need.key === "star") return overall >= 80 ? 12 : overall >= 77 ? 7 : 0;
  if (need.key === "picks") return age <= 24 && potential >= 78 ? 8 : 0;
  return 0;
}

function targetReasonFor(player, needs, sourcePhase, availability = null) {
  const matched = (needs || [])
    .map((need) => ({ need, score: playerTraitMatchesNeed(player, need) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  const needText = matched?.need?.label || "roster fit";
  const sourceText = availability?.reason || (sourcePhase === "rebuilding" ? "seller availability" : sourcePhase === "retooling" ? "retool availability" : "contender surplus");
  return `${needText} • ${sourceText}`;
}

function buildTargetsForTeam(team, phase, needs, teams, intelShellByName, leagueData) {
  const ownName = teamNameOf(team);
  const rows = [];

  for (const sourceTeam of teams || []) {
    const sourceName = teamNameOf(sourceTeam);
    if (!sourceName || normalizeTeamName(sourceName) === normalizeTeamName(ownName)) continue;

    const sourceShell = intelShellByName[normalizeTeamName(sourceName)] || {};
    const sourcePhase = sourceShell.phase || "retooling";

    for (const player of getStandardPlayers(sourceTeam)) {
      const overall = playerOverall(player);
      const potential = playerPotential(player);
      const age = playerAge(player);
      const upside = potential - overall;
      const needScore = (needs || []).reduce((sum, need) => sum + playerTraitMatchesNeed(player, need), 0);
      const availability = sourceAvailabilityForTarget(sourceTeam, player, sourcePhase, sourceShell, leagueData);
      if (!availability.ok) continue;

      let score = needScore + availability.score * 0.75;

      if (phase === "contending") {
        if (overall >= 80 && overall <= 86) score += 25;
        else if (overall >= 76) score += 21;
        else if (overall >= 71) score += 12;
        if (age >= 24 && age <= 34) score += 7;
        if (["rebuilding", "retooling"].includes(sourcePhase) && age >= 27) score += 9;
        if (overall < 69) score -= 12;
      } else if (phase === "retooling") {
        if (age >= 21 && age <= 29) score += 17;
        if (overall >= 73 && potential >= 78) score += 13;
        if (age <= 25 && upside >= 3) score += 11;
        if (sourcePhase === "contending" && availability.score >= 18) score += 8;
        if (age >= 32) score -= 10;
      } else {
        if (age <= 24) score += 24;
        if (age <= 26 && potential >= 78) score += 16;
        if (upside >= 4) score += 12;
        if (sourcePhase === "contending" && availability.score >= 18) score += 9;
        if (age >= 28) score -= 24;
        if (overall >= 84 && age >= 27) score -= 18;
      }

      if (needScore <= 0 && phase !== "rebuilding") score -= 7;
      const threshold = phase === "contending" ? 29 : phase === "retooling" ? 27 : 25;
      if (score < threshold) continue;

      rows.push(decoratePlayer(player, {
        sourceTeamName: sourceName,
        sourceLogo: teamLogoOf(sourceTeam),
        salary: getPlayerSalary(player, leagueData),
        availabilityScore: availability.score,
        maxTargetUses: 3,
        score,
        reason: targetReasonFor(player, needs, sourcePhase, availability),
      }));
    }
  }

  return rows
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.availabilityScore || 0) - Number(a.availabilityScore || 0) || Number(b.overall || 0) - Number(a.overall || 0) || Number(b.potential || 0) - Number(a.potential || 0) || String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, 24);
}

function buildGoals(phase, needs) {
  const base = {
    contending: ["Buy for immediate playoff value", "Protect star core", "Use expendable depth or picks for upgrades"],
    retooling: ["Choose a clear direction", "Clean up roster overlap", "Find younger long-term starters"],
    rebuilding: ["Prioritize picks and prospects", "Shop veterans outside timeline", "Create minutes for young players"],
  };
  const dynamic = [];
  if (needs.some((need) => need.key === "shooting")) dynamic.push("Improve spacing");
  if (needs.some((need) => need.key === "interior_defense")) dynamic.push("Stabilize the paint");
  if (needs.some((need) => need.key === "creation")) dynamic.push("Add another creator");
  if (needs.some((need) => need.key === "picks")) dynamic.push("Turn veterans into future assets");
  return [...new Set([...(base[phase] || base.retooling), ...dynamic])].slice(0, 5);
}

function buildWantProfile(phase, needs) {
  const base = {
    contending: ["Starter upgrades", "Two-way wings", "Bench scoring", "Low-risk veterans"],
    retooling: ["Age 22-28 starters", "High-POT prospects", "Flexible contracts", "Cleaner position balance"],
    rebuilding: ["First-round picks", "Young prospects", "Cap flexibility", "Bad money with assets attached"],
  };
  return [...new Set([...(base[phase] || base.retooling), ...needs.map((need) => need.label)])].slice(0, 6);
}

export function collectOwnedPicksForTeam(leagueData, teamName) {
  if (!leagueData || !teamName) return [];
  const teamNames = getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
  return normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "") === normalizeTeamName(teamName))
    .sort(sortDraftPickAssets);
}

function protectionPenaltyText(protection = "") {
  const text = String(protection || "").toLowerCase();
  if (!text || text === "none" || text === "null" || text.includes("unprotected")) return 0;
  if (text.includes("lottery") || text.includes("1-14")) return 11;
  if (text.includes("top 20")) return 15;
  if (text.includes("top 10")) return 8;
  if (text.includes("top 8")) return 6;
  if (text.includes("top 5")) return 4;
  if (text.includes("top 3")) return 3;
  return 5;
}

export function pickProtectionLabel(pick) {
  const raw = pick?.protection || pick?.protections || pick?.displayProtection || "";
  const label = String(raw || "").trim();
  if (!label || label.toLowerCase() === "none" || label.toLowerCase() === "null") return DEFAULT_PICK_PROTECTION;
  return label;
}

export function formatPick(pick) {
  const round = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "Own";
  const pickNumber = Number(pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || pick?.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${pick?.year || "Future"} ${round}${pickText} - ${original}`;
}

export function pickTradeValue(pick, phase = "retooling", leagueData = null) {
  if (!pick || typeof pick !== "object") return 0;
  const prefs = PHASE_PREFERENCES[phase] || PHASE_PREFERENCES.retooling;
  const round = Number(pick?.round || 1);
  const year = Number(pick?.year || getCurrentSeasonYear(leagueData) + 2);
  const now = getCurrentSeasonYear(leagueData || {});
  const projectedRank = Number(pick?.pickNumber || pick?.overallPick || pick?.projectedRank || pick?.recordRank || pick?.slot || 18);
  const yearsOut = Math.max(0, year - now);
  const futurePenalty = yearsOut * (round === 1 ? 1.75 : 0.7);
  const base = round === 1 ? Math.max(6, 38 - projectedRank * 0.85) : Math.max(1, 7 - projectedRank * 0.08);
  return Math.max(0.5, (base - futurePenalty - protectionPenaltyText(pickProtectionLabel(pick))) * prefs.picks);
}

function buildExpiringContracts(team, leagueData) {
  return getStandardPlayers(team)
    .filter((player) => isExpiring(player, leagueData))
    .sort(
      (a, b) =>
        playerOverall(b) - playerOverall(a) ||
        getPlayerSalary(b, leagueData) - getPlayerSalary(a, leagueData) ||
        playerAge(a) - playerAge(b) ||
        playerNameOf(a).localeCompare(playerNameOf(b))
    )
    .slice(0, 4)
    .map((player) => decoratePlayer(player, { teamName: teamNameOf(team), salary: getPlayerSalary(player, leagueData), reason: "expiring" }));
}

function buildStatusBullets(row) {
  const phaseText = row.phaseLabel.toLowerCase();
  const target = row.targets[0];
  const block = row.tradeBlock.slice(0, 3).map((p) => p.name).join(", ");
  const core = row.untouchables[0];
  const cap = row.capSpace < 0 ? `${formatMoney(row.capSpace)} over cap` : `${formatMoney(row.capSpace)} room`;

  return [
    `Currently ${phaseText}: #${row.power.conferenceRank || "—"} in the ${row.power.conference || "conference"} by power ranking.`,
    target ? `Main target lane: ${target.name} from ${target.sourceTeamName} (${target.reason}).` : "No clean external target stands out from current roster data.",
    block ? `Trade block candidates: ${block}.` : "No obvious trade-block candidates unless they get a strong offer.",
    core ? `${core.name} is the cleanest untouchable/protected player.` : "No true untouchable detected; everyone depends on price and direction.",
    `Cap read: ${cap}; payroll pressure can shape matching salary decisions.`,
  ];
}

function buildIntelForTeam({ team, teams, leagueData, record, powerRow, phase, sourceShellByName }) {
  const name = teamNameOf(team);
  const ratings = powerRow?.ratings || computeSafeTeamRatings(team);
  const needs = buildNeeds(team, phase, ratings);
  const ownedPicks = collectOwnedPicksForTeam(leagueData, name);
  const untouchables = buildUntouchables(team, phase, leagueData, needs);
  const tradeBlock = buildTradeBlock(team, phase, leagueData, untouchables, needs);
  const targets = buildTargetsForTeam(team, phase, needs, teams, sourceShellByName, leagueData);
  const payroll = teamPayroll(team, leagueData);
  const salaryCap = getSalaryCap(leagueData);
  const expiringContracts = buildExpiringContracts(team, leagueData);

  const row = {
    team,
    name,
    logo: teamLogoOf(team),
    phase,
    phaseLabel: PHASE_LABELS[phase] || phase,
    phaseSummary: PHASE_SUMMARIES[phase] || PHASE_SUMMARIES.retooling,
    preferences: PHASE_PREFERENCES[phase] || PHASE_PREFERENCES.retooling,
    record: {
      w: toNum(record?.w, 0),
      l: toNum(record?.l, 0),
      gp: toNum(record?.gp, 0),
      pf: toNum(record?.pf, 0),
      pa: toNum(record?.pa, 0),
      pointDiff: toNum(record?.gp, 0) > 0 ? (toNum(record?.pf, 0) - toNum(record?.pa, 0)) / Math.max(1, toNum(record?.gp, 0)) : 0,
    },
    ratings,
    power: {
      rank: powerRow?.powerRank || 0,
      conferenceRank: powerRow?.conferenceRank || 0,
      conferenceTeamCount: powerRow?.conferenceTeamCount || 15,
      conference: powerRow?.conference || "",
      score: powerRow?.powerScore || ratings.exactOverall || ratings.overall,
      useRecordPowerRankings: Boolean(powerRow?.useRecordPowerRankings),
    },
    payroll,
    salaryCap,
    capSpace: salaryCap - payroll,
    roster: {
      count: getStandardPlayers(team).length,
      avgAge: averageRosterAge(team),
      avgTopOverall: averageTopOverall(team),
    },
    lineup: buildLineup(team),
    goals: buildGoals(phase, needs),
    needs,
    wants: buildWantProfile(phase, needs),
    untouchables,
    core: untouchables,
    tradeBlock,
    movable: tradeBlock,
    targets,
    expiringContracts,
    ownedPicks,
  };

  row.statusBullets = buildStatusBullets(row);
  return row;
}


function sortByOverallDesc(rows = [], limit = rows.length) {
  return [...rows]
    .sort((a, b) =>
      Number(b.overall || 0) - Number(a.overall || 0) ||
      Number(b.potential || 0) - Number(a.potential || 0) ||
      Number(a.age || 99) - Number(b.age || 99) ||
      Number(b.score || 0) - Number(a.score || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    )
    .slice(0, limit);
}

function limitTradeIntelLists(row) {
  const untouchables = sortByOverallDesc(row.untouchables || [], 3);
  const selectedBlock = [...(row.tradeBlock || [])]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.overall || 0) - Number(a.overall || 0) || Number(b.potential || 0) - Number(a.potential || 0) || String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, 4);
  const selectedTargets = [...(row.targets || [])]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.availabilityScore || 0) - Number(a.availabilityScore || 0) || Number(b.overall || 0) - Number(a.overall || 0) || Number(b.potential || 0) - Number(a.potential || 0) || String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, 4);
  const tradeBlock = sortByOverallDesc(selectedBlock, 4);
  const targets = sortByOverallDesc(selectedTargets, 4);
  const expiringContracts = sortByOverallDesc(row.expiringContracts || [], 4);
  return { ...row, untouchables, core: untouchables, tradeBlock, movable: tradeBlock, targets, expiringContracts };
}

function applyTargetFrequencyCap(rows, maxUses = 3, perTeamLimit = 4) {
  const usage = new Map();
  const orderedRows = [...rows].sort((a, b) => (a.power?.rank || 999) - (b.power?.rank || 999));
  const nextByName = new Map();

  for (const row of orderedRows) {
    const selected = [];
    const usedSourceTeams = new Set();
    const candidates = [...(row.targets || [])].sort(
      (a, b) =>
        Number(b.score || 0) - Number(a.score || 0) ||
        Number(b.availabilityScore || 0) - Number(a.availabilityScore || 0) ||
        Number(b.overall || 0) - Number(a.overall || 0) ||
        Number(b.potential || 0) - Number(a.potential || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );

    for (const target of candidates) {
      const key = normalizeTeamName(target.name || playerNameOf(target.player));
      const sourceKey = normalizeTeamName(target.sourceTeamName || "");
      if (sourceKey && usedSourceTeams.has(sourceKey)) continue;

      const used = usage.get(key) || 0;
      const targetMaxUses = Math.min(3, Math.max(0, Number.isFinite(Number(target.maxTargetUses)) ? Number(target.maxTargetUses) : maxUses));
      if (used >= targetMaxUses) continue;

      selected.push(target);
      usage.set(key, used + 1);
      if (sourceKey) usedSourceTeams.add(sourceKey);
      if (selected.length >= perTeamLimit) break;
    }

    nextByName.set(normalizeTeamName(row.name), { ...row, targets: sortByOverallDesc(selected, perTeamLimit) });
  }

  return rows.map((row) => nextByName.get(normalizeTeamName(row.name)) || row);
}

export function buildLeagueIntel(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const records = buildRecordMap(teams);
  const ratingsByTeam = {};
  const autoRatingsCache = readAutoRatingsCache();
  let cacheDirty = false;
  for (const team of teams) {
    ratingsByTeam[teamNameOf(team)] = getTeamRatingsForPowerRankings(team, autoRatingsCache, () => {
      cacheDirty = true;
    });
  }
  if (cacheDirty) writeAutoRatingsCache(autoRatingsCache);

  const powerRows = buildPowerRows(leagueData, teams, records, ratingsByTeam);
  const powerByName = {};
  for (const row of powerRows) powerByName[normalizeTeamName(row.name)] = row;

  const sourceShellByName = {};
  for (const team of teams) {
    const name = teamNameOf(team);
    const powerRow = powerByName[normalizeTeamName(name)] || {};
    const phase = phaseFromConferenceRank(powerRow.conferenceRank || 15);
    sourceShellByName[normalizeTeamName(name)] = {
      phase,
      powerRow,
      untouchables: buildUntouchables(team, phase, null, buildNeeds(team, phase, powerRow?.ratings || computeSafeTeamRatings(team))),
    };
  }

  const rows = teams
    .map((team) => {
      const name = teamNameOf(team);
      const powerRow = powerByName[normalizeTeamName(name)] || {};
      const phase = phaseFromConferenceRank(powerRow.conferenceRank || 15);
      return buildIntelForTeam({
        team,
        teams,
        leagueData,
        record: records[name] || {},
        powerRow,
        phase,
        sourceShellByName,
      });
    })
    .sort((a, b) => (a.power.rank || 999) - (b.power.rank || 999) || a.name.localeCompare(b.name));

  return applyTargetFrequencyCap(rows, 3, 4).map(limitTradeIntelLists);
}

export function phaseTone(phase) {
  if (phase === "contending") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (phase === "retooling") return "border-orange-400/30 bg-orange-500/10 text-orange-100";
  return "border-purple-400/30 bg-purple-500/10 text-purple-100";
}

export { PHASE_LABELS, POSITION_LABELS };
