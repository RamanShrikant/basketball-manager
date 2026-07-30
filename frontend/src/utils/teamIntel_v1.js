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

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";
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
  return parseMaybeCompressed(safeLocalStorageGet(SCHEDULE_KEY), {}) || {};
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

  const posThreshold = phase === "contending" ? 82 : phase === "retooling" ? 79 : 76;
  const weakestPositions = POSITIONS
    .map((pos) => ({ pos, score: posScores[pos] || 0 }))
    .sort((a, b) => a.score - b.score);

  for (const row of weakestPositions.slice(0, 2)) {
    if (row.score < posThreshold) {
      const label =
        row.pos === "PG"
          ? "Lead guard"
          : row.pos === "C"
          ? "Center / rim protector"
          : `${row.pos} upgrade`;
      pushNeed(`pos_${row.pos}`, label, Math.max(8, 96 - row.score), `${row.pos} top option is ${Math.round(row.score)} OVR.`, row.pos);
    }
  }

  const shooting = attrAvg(top8, 0, 70);
  const passing = attrAvg(top8, 5, 70);
  const ball = attrAvg(top8, 4, 70);
  const perD = attrAvg(top8, 8, 70);
  const insD = attrAvg(top8, 9, 70);
  const reb = attrAvg(top8, 12, 70);
  const eighth = playerOverall(topRotation(team, 8)[7] || {});

  if (shooting < 75) pushNeed("shooting", "Shooting / spacing", 14, `Top rotation 3PT avg is ${Math.round(shooting)}.`);
  if (phase !== "rebuilding" && (passing < 74 || ball < 74)) pushNeed("creation", "Secondary creator", 12, "Needs more ball handling and passing.");
  if (perD < 75) pushNeed("perimeter_defense", "Point-of-attack defense", 11, `Perimeter defense avg is ${Math.round(perD)}.`);
  if (insD < 75 || reb < 75) pushNeed("interior_defense", "Interior defense / rebounding", 10, "Frontcourt defense or boards are light.", "C");
  if (eighth && eighth < 76 && phase === "contending") pushNeed("depth", "Bench depth", 9, `8th man is around ${Math.round(eighth)} OVR.`);
  if (phase === "rebuilding") {
    pushNeed("picks", "Draft capital", 16, "Future-focused team should stockpile picks.");
    pushNeed("young_upside", "Young upside", 15, "Timeline needs prospects more than older vets.");
  }
  if (phase === "contending" && toNum(ratings?.overall, 0) < 87) pushNeed("star", "Top-end talent", 13, "Good team, but short one premium piece.");

  return needs.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

function getUntouchableStatus(player, phase) {
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const upside = potential - overall;

  if (phase === "contending") {
    if (overall >= 94) return { level: "franchise", label: "Franchise star" };
    if (overall >= 91 && age >= 24 && age <= 32) return { level: "prime", label: "Prime title piece" };
    if (age <= 23 && potential >= 90 && overall >= 78) return { level: "bluechip", label: "Blue-chip prospect" };
    if (age <= 25 && overall >= 88 && potential >= 91) return { level: "youngstar", label: "Young star" };
  }

  if (phase === "retooling") {
    // Retooling teams only mark true anchors as untouchable.
    // Good starters like 85-86 OVR / 88-89 POT should be valuable, not protected.
    if (overall >= 94 && age <= 32) return { level: "franchise", label: "Franchise star" };
    if (overall >= 92 && age <= 30) return { level: "star", label: "Star anchor" };
    if (age <= 25 && overall >= 90 && potential >= 93) return { level: "youngcore", label: "Young core" };
    if (age <= 23 && overall >= 86 && potential >= 95) return { level: "future", label: "Franchise upside" };
  }

  if (phase === "rebuilding") {
    // Rebuilding teams should protect only real franchise pieces/prospects.
    // This intentionally keeps players like Josh Giddey or Kel'el Ware movable in the right offer.
    if (overall >= 94 && age <= 28) return { level: "franchise", label: "Young franchise star" };
    if (age <= 25 && overall >= 89 && potential >= 93) return { level: "youngstar", label: "Young star" };
    if (age <= 22 && overall >= 80 && potential >= 94) return { level: "future", label: "Franchise prospect" };
    if (age <= 21 && overall >= 76 && potential >= 95) return { level: "bluechip", label: "Blue-chip prospect" };
    if (overall >= 97 && age >= 31) return null;
  }

  if (potential >= 95 && age <= 22 && overall >= 80 && upside >= 4) return { level: "bluechip", label: "Protected upside" };
  return null;
}

function isProtectedYoungAsset(player, phase = "retooling") {
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const upside = potential - overall;

  if (age <= 23 && potential >= 90 && overall >= 76) return true;
  if (age <= 24 && potential >= 88 && upside >= 6) return true;
  if (phase === "rebuilding" && age <= 25 && potential >= 86 && overall >= 74) return true;
  return false;
}

function buildUntouchables(team, phase) {
  return getStandardPlayers(team)
    .map((player) => {
      const status = getUntouchableStatus(player, phase);
      const score = playerOverall(player) * 1.55 + Math.max(0, playerPotential(player) - playerOverall(player)) * 2.4 + Math.max(0, 28 - playerAge(player)) * 1.3;
      return { player, status, score };
    })
    .filter((row) => row.status)
    .sort(
      (a, b) =>
        playerOverall(b.player) - playerOverall(a.player) ||
        playerPotential(b.player) - playerPotential(a.player) ||
        playerAge(a.player) - playerAge(b.player) ||
        b.score - a.score
    )
    .slice(0, 3)
    .map((row) => decoratePlayer(row.player, { reason: row.status.label }));
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
  const players = getStandardPlayers(team).sort((a, b) => playerOverall(b) - playerOverall(a));
  const used = new Set();
  const slots = [];

  for (const pos of POSITIONS) {
    const best = players.find((p) => !used.has(playerNameOf(p)) && (p?.pos === pos || p?.secondaryPos === pos));
    const fallback = players.find((p) => !used.has(playerNameOf(p)));
    const pick = best || fallback;
    if (pick) used.add(playerNameOf(pick));
    slots.push({ label: pos, player: pick ? decoratePlayer(pick) : null });
  }

  const sixth = players.find((p) => !used.has(playerNameOf(p)));
  slots.push({ label: "6TH", player: sixth ? decoratePlayer(sixth) : null });
  return slots;
}

function buildTradeBlock(team, phase, leagueData, untouchables = []) {
  const untouchableNames = new Set(untouchables.map((row) => normalizeTeamName(row.name)));
  const minutes = getRotationMinutes(team);

  return getStandardPlayers(team)
    .filter((player) => !untouchableNames.has(normalizeTeamName(playerNameOf(player))))
    .filter((player) => !isProtectedYoungAsset(player, phase))
    .map((player) => {
      const overall = playerOverall(player);
      const potential = playerPotential(player);
      const age = playerAge(player);
      const salary = getPlayerSalary(player, leagueData);
      const years = contractYearsLeft(player, leagueData);
      const mpg = toNum(minutes[playerNameOf(player)], 0);
      const crowding = positionalCrowding(player, team);
      const reasons = [];
      let score = 0;

      if (phase === "rebuilding" && age >= 28 && overall >= 74) {
        score += 28;
        reasons.push("veteran outside timeline");
      }
      if (phase === "rebuilding" && overall >= 90 && age >= 30) {
        score += 20;
        reasons.push("star trade chip");
      }
      if (phase === "retooling" && age >= 30 && overall >= 76) {
        score += 18;
        reasons.push("older retool piece");
      }
      if (phase === "contending" && overall <= 76) {
        score += 10;
        reasons.push("expendable depth");
      }
      if (overall >= 77 && mpg > 0 && mpg < 18) {
        score += 14;
        reasons.push("buried in rotation");
      }
      if (crowding > 0) {
        score += crowding * 6;
        reasons.push("position overload");
      }
      if (salary >= 18_000_000 && overall < 84) {
        score += 16;
        reasons.push("salary flexibility");
      }
      if (years >= 3 && salary >= 14_000_000 && overall < 82) {
        score += 9;
        reasons.push("long money");
      }
      if (isExpiring(player, leagueData) && phase !== "contending" && age >= 27) {
        score += 10;
        reasons.push("expiring veteran");
      }
      if (potential <= overall + 1 && age >= 28 && phase !== "contending") {
        score += 8;
        reasons.push("limited upside");
      }

      return decoratePlayer(player, {
        salary,
        mpg,
        score,
        reason: reasons.slice(0, 2).join(" / ") || "available in the right offer",
      });
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.overall - a.overall || b.potential - a.potential || a.name.localeCompare(b.name))
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
  if (need.key === "shooting") return toNum(attrs[0], 60) >= 78 ? 14 : 0;
  if (need.key === "creation") return toNum(attrs[4], 60) + toNum(attrs[5], 60) >= 154 ? 13 : 0;
  if (need.key === "perimeter_defense") return toNum(attrs[8], 60) >= 80 ? 12 : 0;
  if (need.key === "interior_defense") return pos === "C" || secondary === "C" || toNum(attrs[9], 60) + toNum(attrs[10], 60) + toNum(attrs[12], 60) >= 230 ? 12 : 0;
  if (need.key === "depth") return overall >= 76 && overall <= 84 ? 11 : 0;
  if (need.key === "young_upside") return age <= 24 && (potential >= overall + 3 || potential >= 84) ? 15 : 0;
  if (need.key === "star") return overall >= 86 ? 12 : 0;
  return 0;
}

function targetReasonFor(player, needs, sourcePhase) {
  const matched = needs
    .map((need) => ({ need, score: playerTraitMatchesNeed(player, need) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  const sourceText = sourcePhase === "rebuilding" ? "rebuilding seller" : sourcePhase === "retooling" ? "retooling fit" : "contender depth";
  return matched ? `${matched.need.label} • ${sourceText}` : sourceText;
}

function buildTargetsForTeam(team, phase, needs, teams, intelShellByName, leagueData) {
  const ownName = teamNameOf(team);
  const rows = [];

  for (const sourceTeam of teams || []) {
    const sourceName = teamNameOf(sourceTeam);
    if (!sourceName || normalizeTeamName(sourceName) === normalizeTeamName(ownName)) continue;

    const sourceShell = intelShellByName[normalizeTeamName(sourceName)] || {};
    const sourcePhase = sourceShell.phase || "retooling";
    const sourceUntouchables = new Set((sourceShell.untouchables || []).map((row) => normalizeTeamName(row.name)));
    const sourceMinutes = getRotationMinutes(sourceTeam);

    for (const player of getStandardPlayers(sourceTeam)) {
      const name = playerNameOf(player);
      if (sourceUntouchables.has(normalizeTeamName(name))) continue;

      const overall = playerOverall(player);
      const potential = playerPotential(player);
      const age = playerAge(player);
      const needScore = needs.reduce((sum, need) => sum + playerTraitMatchesNeed(player, need), 0);
      const mpg = toNum(sourceMinutes[name], 0);
      const crowding = positionalCrowding(player, sourceTeam);
      let score = needScore;

      if (phase === "contending") {
        if (overall >= 78 && overall <= 89) score += 18;
        if (age >= 25 && age <= 33) score += 7;
        if (["rebuilding", "retooling"].includes(sourcePhase) && age >= 27) score += 11;
        if (overall < 75) score -= 16;
      } else if (phase === "retooling") {
        if (age >= 22 && age <= 28) score += 14;
        if (overall >= 77 && potential >= 82) score += 10;
        if (sourcePhase === "contending" && mpg < 20 && overall >= 77) score += 8;
      } else {
        if (age <= 24) score += 21;
        if (potential >= overall + 4) score += 15;
        if (potential >= 86) score += 10;
        if (age >= 29) score -= 25;
        if (overall >= 90 && age >= 27) score -= 16;
      }

      if (mpg > 0 && mpg < 18 && overall >= 76) score += 8;
      if (crowding > 0) score += crowding * 3;
      if (overall >= 94) score -= 30;
      if (age <= 22 && potential >= 92) score -= 16;
      if (needScore <= 0 && phase !== "rebuilding") score -= 8;
      if (score <= 14) continue;

      rows.push(decoratePlayer(player, {
        sourceTeamName: sourceName,
        sourceLogo: teamLogoOf(sourceTeam),
        salary: getPlayerSalary(player, leagueData),
        score,
        reason: targetReasonFor(player, needs, sourcePhase),
      }));
    }
  }

  return rows
    .sort((a, b) => b.score - a.score || b.overall - a.overall || b.potential - a.potential || a.name.localeCompare(b.name))
    .slice(0, 14);
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
    .map((player) => decoratePlayer(player, { salary: getPlayerSalary(player, leagueData), reason: "expiring" }));
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
  const untouchables = buildUntouchables(team, phase);
  const tradeBlock = buildTradeBlock(team, phase, leagueData, untouchables);
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
      b.overall - a.overall ||
      b.potential - a.potential ||
      a.age - b.age ||
      Number(b.score || 0) - Number(a.score || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    )
    .slice(0, limit);
}

function limitTradeIntelLists(row) {
  const untouchables = sortByOverallDesc(row.untouchables || [], 3);
  const tradeBlock = sortByOverallDesc(row.tradeBlock || [], 4);
  const targets = sortByOverallDesc(row.targets || [], 4);
  const expiringContracts = sortByOverallDesc(row.expiringContracts || [], 4);
  return {
    ...row,
    untouchables,
    core: untouchables,
    tradeBlock,
    movable: tradeBlock,
    targets,
    expiringContracts,
  };
}

function applyTargetFrequencyCap(rows, maxUses = 3, perTeamLimit = 4) {
  const usage = new Map();
  const orderedRows = [...rows].sort((a, b) => (a.power?.rank || 999) - (b.power?.rank || 999));
  const nextByName = new Map();

  for (const row of orderedRows) {
    const selected = [];
    const candidates = [...(row.targets || [])].sort(
      (a, b) =>
        Number(b.score || 0) - Number(a.score || 0) ||
        b.overall - a.overall ||
        b.potential - a.potential ||
        a.age - b.age ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );

    for (const target of candidates) {
      const key = normalizeTeamName(target.name || playerNameOf(target.player));
      const used = usage.get(key) || 0;
      if (used >= maxUses) continue;
      selected.push(target);
      usage.set(key, used + 1);
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
      untouchables: buildUntouchables(team, phase),
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
