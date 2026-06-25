import LZString from "lz-string";
import { computeTeamRatings } from "../api/teamRatings.js";
import {
  buildSmartRotation,
  calculateTeamPotentialRating,
} from "./ensureGameplans.js";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";

const CPU_INCOMING_PICK_VALUE_MULT = 0.985;
const CPU_OUTGOING_PICK_VALUE_MULT = 1.015;

const YEAR_BLEND_BY_OFFSET = [
  { power: 1.0, pot: 0.0, certainty: 1.0 },
  { power: 0.85, pot: 0.15, certainty: 0.97 },
  { power: 0.7, pot: 0.3, certainty: 0.94 },
  { power: 0.55, pot: 0.45, certainty: 0.91 },
  { power: 0.4, pot: 0.6, certainty: 0.88 },
  { power: 0.2, pot: 0.8, certainty: 0.85 },
  { power: 0.0, pot: 1.0, certainty: 0.82 },
];

// Rank 1 is the best team / lowest-value pick. Rank 30 is the worst team / highest-value pick.
// These explicit tables keep every single Power Ranking and POT rank from carrying the same value.
const CURRENT_POWER_FIRST_VALUE_BY_RANK = {
  1: 0.35, 2: 0.37, 3: 0.39, 4: 0.42, 5: 0.45,
  6: 0.49, 7: 0.53, 8: 0.58, 9: 0.64, 10: 0.71,
  11: 0.79, 12: 0.88, 13: 0.98, 14: 1.09, 15: 1.21,
  16: 1.34, 17: 1.47, 18: 1.6, 19: 1.72, 20: 1.84,
  21: 1.95, 22: 2.05, 23: 2.15, 24: 2.24, 25: 2.34,
  26: 2.45, 27: 2.57, 28: 2.69, 29: 2.82, 30: 2.96,
};

const CURRENT_POWER_SECOND_VALUE_BY_RANK = {
  1: 0.025, 2: 0.027, 3: 0.03, 4: 0.033, 5: 0.036,
  6: 0.04, 7: 0.044, 8: 0.049, 9: 0.055, 10: 0.062,
  11: 0.07, 12: 0.079, 13: 0.089, 14: 0.1, 15: 0.112,
  16: 0.125, 17: 0.139, 18: 0.153, 19: 0.166, 20: 0.178,
  21: 0.189, 22: 0.199, 23: 0.208, 24: 0.216, 25: 0.224,
  26: 0.232, 27: 0.24, 28: 0.248, 29: 0.256, 30: 0.265,
};

const FUTURE_POT_FIRST_VALUE_BY_RANK = {
  1: 0.34, 2: 0.36, 3: 0.38, 4: 0.41, 5: 0.44,
  6: 0.48, 7: 0.52, 8: 0.57, 9: 0.63, 10: 0.7,
  11: 0.78, 12: 0.87, 13: 0.97, 14: 1.08, 15: 1.19,
  16: 1.31, 17: 1.43, 18: 1.55, 19: 1.66, 20: 1.76,
  21: 1.85, 22: 1.93, 23: 2.0, 24: 2.07, 25: 2.14,
  26: 2.2, 27: 2.26, 28: 2.32, 29: 2.38, 30: 2.45,
};

const FUTURE_POT_SECOND_VALUE_BY_RANK = {
  1: 0.024, 2: 0.026, 3: 0.028, 4: 0.031, 5: 0.034,
  6: 0.038, 7: 0.042, 8: 0.047, 9: 0.053, 10: 0.06,
  11: 0.068, 12: 0.077, 13: 0.087, 14: 0.098, 15: 0.11,
  16: 0.122, 17: 0.135, 18: 0.148, 19: 0.16, 20: 0.171,
  21: 0.181, 22: 0.19, 23: 0.198, 24: 0.205, 25: 0.212,
  26: 0.218, 27: 0.224, 28: 0.23, 29: 0.236, 30: 0.242,
};

const FIRST_SLOT_VALUE = {
  1: 3.05, 2: 2.85, 3: 2.68, 4: 2.52, 5: 2.36,
  6: 2.19, 7: 2.02, 8: 1.86, 9: 1.71, 10: 1.57,
  11: 1.43, 12: 1.3, 13: 1.18, 14: 1.07, 15: 0.96,
  16: 0.86, 17: 0.78, 18: 0.71, 19: 0.65, 20: 0.6,
  21: 0.56, 22: 0.52, 23: 0.49, 24: 0.46, 25: 0.43,
  26: 0.41, 27: 0.39, 28: 0.37, 29: 0.36, 30: 0.35,
};

const SECOND_SLOT_VALUE = {
  31: 0.27, 32: 0.255, 33: 0.241, 34: 0.228, 35: 0.215,
  36: 0.203, 37: 0.192, 38: 0.181, 39: 0.171, 40: 0.161,
  41: 0.151, 42: 0.142, 43: 0.133, 44: 0.124, 45: 0.116,
  46: 0.108, 47: 0.1, 48: 0.092, 49: 0.085, 50: 0.078,
  51: 0.071, 52: 0.064, 53: 0.058, 54: 0.052, 55: 0.047,
  56: 0.042, 57: 0.038, 58: 0.034, 59: 0.03, 60: 0.027,
};

const TRADE_PICK_EPS = 0.005;
const FREE_SWAP_OPTION_VALUE = 0.02;

const round4 = (value) => Math.round(Number(value || 0) * 10000) / 10000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function displayTeamName(value = "") {
  return String(value || "").trim() || "Unknown team";
}

function sameTeamName(a = "", b = "") {
  return normalizeName(a) === normalizeName(b);
}

function isSwapTradeItem(item = {}) {
  const rule = item?.tradeRule || item?.pick?.tradeRule || {};
  return item?.type === "pick" && (String(rule.action || "").toLowerCase() === "swap" || Boolean(rule.swapId));
}

function swapTeamPairMatches(item = {}, userTeamName = "", cpuTeamName = "") {
  if (!isSwapTradeItem(item)) return true;
  if (!userTeamName || !cpuTeamName) return true;

  const rule = item?.tradeRule || item?.pick?.tradeRule || {};
  const from = rule.fromTeamName || rule.fromTeam || rule.sourceOwnerTeam || "";
  const to = rule.toTeamName || rule.toTeam || rule.swapRightHolder || rule.targetOwnerTeam || "";

  // Older saved swap items may not have explicit from/to fields. Do not break
  // those unless the fields prove the swap is stale.
  if (!from || !to) return true;

  const direct = sameTeamName(from, userTeamName) && sameTeamName(to, cpuTeamName);
  const reverse = sameTeamName(from, cpuTeamName) && sameTeamName(to, userTeamName);
  return direct || reverse;
}

function describeSwapTeamPair(item = {}) {
  const rule = item?.tradeRule || item?.pick?.tradeRule || {};
  const from = displayTeamName(rule.fromTeamName || rule.fromTeam || "one side");
  const to = displayTeamName(rule.toTeamName || rule.toTeam || rule.swapRightHolder || "the other side");
  const year = getPickYear(rule.sourcePick || item?.pick || {}, {});
  const round = getPickRound(rule.sourcePick || item?.pick || {});
  return `${year} ${formatRound(round)} swap between ${from} and ${to}`;
}

function getTeamName(team = {}) {
  return team?.name || team?.teamName || team?.team || "";
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function parseMaybeCompressed(raw, fallback = null) {
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

function safeLocalStorageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function resultV3Key(gameId) {
  return `${RESULT_V3_PREFIX}${gameId}`;
}

function loadSchedule() {
  return parseMaybeCompressed(safeLocalStorageGet(SCHEDULE_KEY), {}) || {};
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

function buildRecordMap() {
  const schedule = loadSchedule();
  const results = loadResultsV3();
  const map = {};

  const ensure = (teamName) => {
    if (!teamName) return null;
    if (!map[teamName]) map[teamName] = { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    return map[teamName];
  };

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

function playerRatingSignature(player = {}) {
  return [
    player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? "",
    normalizeName(player?.name || player?.player || ""),
    player?.pos || "",
    player?.secondaryPos || "",
    toNum(player?.age, 0),
    toNum(player?.overall ?? player?.ovr, 0),
    toNum(player?.potential ?? player?.pot, 0),
    toNum(player?.offRating ?? player?.off ?? player?.overall ?? player?.ovr, 0),
    toNum(player?.defRating ?? player?.def ?? player?.overall ?? player?.ovr, 0),
    toNum(player?.stamina ?? player?.sta, 0),
  ].join("|");
}

function rosterRatingSignature(players = []) {
  return (players || [])
    .map(playerRatingSignature)
    .sort()
    .join("||");
}

function parseSavedGameplan(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function namesSet(players = []) {
  return new Set((players || []).map((player) => player?.name || player?.player || "").filter(Boolean));
}

function setMatches(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function getCachedAutoMinutes(teamName, players = []) {
  const saved = parseSavedGameplan(safeLocalStorageGet(`gameplan_${teamName}`));
  if (!saved || saved.manualLocked || saved.userEdited || saved.source === "coach_gameplan") return null;
  if (!saved.minutes || typeof saved.minutes !== "object") return null;

  const liveNames = namesSet(players);
  const minuteNames = new Set(Object.keys(saved.minutes || {}).filter(Boolean));
  if (!setMatches(liveNames, minuteNames)) return null;

  for (const name of minuteNames) {
    if (!Number.isFinite(Number(saved.minutes[name]))) return null;
  }

  return saved.minutes;
}

const rankCache = new Map();

function calculatePowerOverall(team = {}) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const valid = players.filter((p) => p && (p.name || p.player) && Number.isFinite(Number(p.overall ?? p.ovr)));
  if (!valid.length) return { exactOverall: 0, exactOff: 0, exactDef: 0 };

  let minutes = getCachedAutoMinutes(getTeamName(team), valid);
  if (!minutes) {
    try {
      const built = buildSmartRotation(valid);
      minutes = built?.obj && typeof built.obj === "object" ? built.obj : {};
    } catch {
      minutes = {};
    }
  }

  const ratings = computeTeamRatings({ players: valid }, minutes);
  return {
    exactOverall: round4(ratings?.exactOverall ?? ratings?.overall ?? 0),
    exactOff: round4(ratings?.exactOff ?? ratings?.off ?? 0),
    exactDef: round4(ratings?.exactDef ?? ratings?.def ?? 0),
  };
}

function calculatePot(team = {}) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const valid = players.filter((p) => p && (p.name || p.player) && Number.isFinite(Number(p.overall ?? p.ovr)));
  if (!valid.length) return 0;

  try {
    const ratings = calculateTeamPotentialRating(valid);
    return round4(ratings?.exactPot ?? ratings?.pot ?? 0);
  } catch {
    return 0;
  }
}

function buildPickRankContext(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const signature = teams
    .map((team) => `${normalizeName(getTeamName(team))}:${rosterRatingSignature(team?.players || [])}`)
    .sort()
    .join("##");
  const cacheKey = `${signature}::${safeLocalStorageGet(RESULT_V3_INDEX_KEY) || ""}::${safeLocalStorageGet(SCHEDULE_KEY) || ""}`;
  if (rankCache.has(cacheKey)) return rankCache.get(cacheKey);

  const records = buildRecordMap();
  const baseRows = teams.map((team) => {
    const name = getTeamName(team);
    const ratings = calculatePowerOverall(team);
    const record = records?.[name] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    const gp = toNum(record.gp, 0);
    const diff = toNum(record.pf, 0) - toNum(record.pa, 0);

    return {
      team,
      name,
      exactOverall: ratings.exactOverall,
      offDef: ratings.exactOff + ratings.exactDef,
      exactPot: calculatePot(team),
      w: toNum(record.w, 0),
      l: toNum(record.l, 0),
      gp,
      winPct: gp > 0 ? toNum(record.w, 0) / gp : 0,
      pointDiff: gp > 0 ? diff / gp : 0,
    };
  });

  const useRecordPowerRankings = baseRows.length > 0 && baseRows.every((row) => row.gp >= 20);

  const powerRows = baseRows
    .map((row) => ({
      ...row,
      recordScore: row.winPct * 100,
      powerScore: useRecordPowerRankings ? row.exactOverall * 0.5 + row.winPct * 100 * 0.5 : row.exactOverall,
      useRecordPowerRankings,
    }))
    .sort(
      (a, b) =>
        b.powerScore - a.powerScore ||
        (useRecordPowerRankings ? b.winPct - a.winPct : 0) ||
        b.exactOverall - a.exactOverall ||
        b.offDef - a.offDef ||
        b.pointDiff - a.pointDiff ||
        b.w - a.w ||
        String(a.name || "").localeCompare(String(b.name || ""))
    )
    .map((row, idx) => ({ ...row, powerRank: idx + 1 }));

  const potRows = [...baseRows]
    .sort(
      (a, b) =>
        b.exactPot - a.exactPot ||
        b.exactOverall - a.exactOverall ||
        String(a.name || "").localeCompare(String(b.name || ""))
    )
    .map((row, idx) => ({ ...row, potRank: idx + 1 }));

  const byTeam = new Map();
  for (const row of powerRows) {
    byTeam.set(normalizeName(row.name), {
      teamName: row.name,
      powerRank: row.powerRank,
      exactOverall: row.exactOverall,
      useRecordPowerRankings,
    });
  }
  for (const row of potRows) {
    const key = normalizeName(row.name);
    byTeam.set(key, {
      ...(byTeam.get(key) || { teamName: row.name }),
      potRank: row.potRank,
      exactPot: row.exactPot,
    });
  }

  const context = { byTeam, powerRows, potRows, useRecordPowerRankings, teamCount: teams.length || 30 };
  rankCache.set(cacheKey, context);
  while (rankCache.size > 6) rankCache.delete(rankCache.keys().next().value);
  return context;
}

function getCurrentSeasonYear(leagueData = {}) {
  const candidates = [
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonStartYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);
  return candidates.length ? Math.max(...candidates) : 2026;
}

function getPickRound(pick = {}) {
  const round = Number(pick.round || pick.rnd || pick.pickRound || 0);
  if (round === 1 || round === 2) return round;
  const pickNumber = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.pick || 0);
  return pickNumber && pickNumber <= 30 ? 1 : 2;
}

function getPickNumber(pick = {}) {
  const n = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.pick || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getPickOriginalTeam(pick = {}) {
  return String(
    pick.originalTeam ||
      pick.originalTeamName ||
      pick.originalPickTeamName ||
      pick.naturalLotteryTeamName ||
      pick.team ||
      pick.teamName ||
      pick.fromTeam ||
      ""
  ).trim();
}

function getPickYear(pick = {}, leagueData = {}) {
  const current = getCurrentSeasonYear(leagueData);
  const year = Number(pick.year || pick.seasonYear || pick.season || current);
  return Number.isFinite(year) && year >= 2020 ? year : current;
}

function getYearBlend(year, leagueData) {
  const offset = clamp(Math.round(getPickYear({ year }, leagueData) - getCurrentSeasonYear(leagueData)), 0, YEAR_BLEND_BY_OFFSET.length - 1);
  return { offset, ...YEAR_BLEND_BY_OFFSET[offset] };
}

function tableLookup(table, rank) {
  const n = clamp(Math.round(Number(rank || 15)), 1, 30);
  return Number(table[n] || table[15] || 0);
}

function slotValue(round, slot) {
  const n = Math.round(Number(slot || 0));
  if (Number(round) === 2) return Number(SECOND_SLOT_VALUE[clamp(n, 31, 60)] || 0.05);
  return Number(FIRST_SLOT_VALUE[clamp(n, 1, 30)] || 0.35);
}

function getFullSlotRange(round) {
  return Number(round) === 2 ? { start: 31, end: 60 } : { start: 1, end: 30 };
}

function normalizeRange(range = null, round = 1) {
  if (!range || typeof range !== "object") return getFullSlotRange(round);
  const full = getFullSlotRange(round);
  const start = clamp(Math.round(Number(range.start || full.start)), full.start, full.end);
  const end = clamp(Math.round(Number(range.end || full.end)), full.start, full.end);
  if (end < start) return full;
  return { start, end };
}

function getRangeFromItem(item = {}, round = 1) {
  const pick = item.pick || item || {};
  const rule = item.tradeRule || pick.tradeRule || {};
  const pickNumber = getPickNumber(pick);
  if (pickNumber > 0) return { start: pickNumber, end: pickNumber };

  const candidate =
    rule.conveyedRange ||
    rule.ownedRange ||
    pick.ownedRange ||
    pick.ownedSlots ||
    null;

  return normalizeRange(candidate, round);
}

function expectedSlotFromRank(rank, round, yearOffset = 0) {
  const r = clamp(Number(rank || 15), 1, 30);
  if (Number(round) === 2) return clamp(61 - r, 31, 60);

  let slot = 31 - r;
  if (yearOffset === 0) {
    // Tiny 1-2-3 lottery realism: bottom-three picks are not guaranteed #1, but the downside remains premium.
    if (r >= 29.5) slot = 3.15;
    else if (r >= 28.5) slot = 3.75;
    else if (r >= 27.5) slot = 4.35;
  }
  return clamp(slot, 1, 30);
}

function gaussianProbability(slot, mean, sd) {
  const z = (Number(slot) - Number(mean)) / Math.max(0.01, sd);
  return Math.exp(-0.5 * z * z);
}

function distributionExpectedSlotValue({ round, expectedSlot, yearOffset, range }) {
  const full = getFullSlotRange(round);
  const normalizedRange = normalizeRange(range, round);
  const sd = Number(round) === 2 ? 3.1 + yearOffset * 1.7 : 2.2 + yearOffset * 1.3;
  let totalWeight = 0;
  let fullValue = 0;
  let rangedValue = 0;
  let conveyWeight = 0;

  for (let slot = full.start; slot <= full.end; slot += 1) {
    const weight = gaussianProbability(slot, expectedSlot, sd);
    const value = slotValue(round, slot);
    totalWeight += weight;
    fullValue += weight * value;
    if (slot >= normalizedRange.start && slot <= normalizedRange.end) {
      rangedValue += weight * value;
      conveyWeight += weight;
    }
  }

  if (totalWeight <= 0) return { ratio: 1, conveyanceChance: 1, fullSlotValue: 0, rangedSlotValue: 0 };

  return {
    ratio: fullValue > 0 ? clamp(rangedValue / fullValue, 0, 1) : 1,
    conveyanceChance: clamp(conveyWeight / totalWeight, 0, 1),
    fullSlotValue: fullValue / totalWeight,
    rangedSlotValue: rangedValue / totalWeight,
  };
}

function valueTablesForRound(round) {
  if (Number(round) === 2) {
    return {
      power: CURRENT_POWER_SECOND_VALUE_BY_RANK,
      pot: FUTURE_POT_SECOND_VALUE_BY_RANK,
    };
  }
  return {
    power: CURRENT_POWER_FIRST_VALUE_BY_RANK,
    pot: FUTURE_POT_FIRST_VALUE_BY_RANK,
  };
}

function formatRound(round) {
  return Number(round) === 2 ? "2nd" : "1st";
}

function formatRange(range, round) {
  const full = getFullSlotRange(round);
  const normalized = normalizeRange(range, round);
  if (normalized.start === full.start && normalized.end === full.end) return "unprotected/full range";
  if (normalized.start === normalized.end) return `pick #${normalized.start}`;
  return `slots ${normalized.start}-${normalized.end}`;
}

function inverseSwapDirection(direction) {
  return String(direction || "best").toLowerCase() === "worst" ? "best" : "worst";
}

function swapDirectionLabel(direction) {
  return String(direction || "best").toLowerCase() === "worst" ? "worst-pick" : "best-pick";
}

function projectSinglePickValue(item = {}, leagueData = {}, context = buildPickRankContext(leagueData)) {
  const pick = item.pick || item || {};
  const round = getPickRound(pick);
  const pickYear = getPickYear(pick, leagueData);
  const currentYear = getCurrentSeasonYear(leagueData);
  const { offset, power, pot, certainty } = getYearBlend(pickYear, leagueData);
  const originalTeam = getPickOriginalTeam(pick);
  const teamContext = context.byTeam.get(normalizeName(originalTeam)) || {};
  const powerRank = clamp(Number(teamContext.powerRank || 15), 1, 30);
  const potRank = clamp(Number(teamContext.potRank || powerRank || 15), 1, 30);
  const tables = valueTablesForRound(round);
  const powerValue = tableLookup(tables.power, powerRank);
  const potValue = tableLookup(tables.pot, potRank);
  let unprotectedValue = (powerValue * power + potValue * pot) * certainty;
  const blendedRank = clamp(powerRank * power + potRank * pot, 1, 30);
  const pickNumber = getPickNumber(pick);
  const expectedSlot = pickNumber || expectedSlotFromRank(blendedRank, round, offset);
  const range = getRangeFromItem(item, round);
  const rangeModel = distributionExpectedSlotValue({ round, expectedSlot, yearOffset: offset, range });

  if (pickNumber > 0) {
    unprotectedValue = slotValue(round, pickNumber) * certainty;
  } else if (offset === 0 && round === 1 && powerRank >= 28) {
    const lotteryMultiplier = powerRank >= 30 ? 0.978 : powerRank >= 29 ? 0.985 : 0.992;
    unprotectedValue *= lotteryMultiplier;
  }

  const effectiveRangeRatio = pickNumber > 0 ? 1 : rangeModel.ratio;
  const effectiveConveyanceChance = pickNumber > 0 ? 1 : rangeModel.conveyanceChance;
  const value = round4(unprotectedValue * effectiveRangeRatio);
  const protectionText = String(item.protection || pick.displayProtection || pick.protections || pick.protection || "Unprotected");
  const rangeIsFull = normalizeRange(range, round).start === getFullSlotRange(round).start && normalizeRange(range, round).end === getFullSlotRange(round).end;
  const rankSource = offset === 0 ? `Power Rank #${powerRank}` : `Power Rank #${powerRank} / POT Rank #${potRank}`;
  const blendLabel = offset === 0 ? "current-year Power Ranking" : `${Math.round(power * 100)}% Power Ranking / ${Math.round(pot * 100)}% POT`;
  const originalLabel = displayTeamName(originalTeam);
  const reason = `${pickYear} ${originalLabel} ${formatRound(round)} valued at ${value.toFixed(3)} (${rankSource}, ${blendLabel}, ${formatRange(range, round)}${rangeIsFull ? "" : `, ${(effectiveConveyanceChance * 100).toFixed(0)}% convey chance`}).`;

  return {
    value,
    rawUnprotectedValue: round4(unprotectedValue),
    rangeRatio: round4(effectiveRangeRatio),
    conveyanceChance: round4(effectiveConveyanceChance),
    expectedSlot: round4(expectedSlot),
    powerRank,
    potRank,
    blendedRank: round4(blendedRank),
    yearOffset: offset,
    round,
    year: pickYear,
    currentYear,
    originalTeam,
    protectionText,
    range,
    reason,
  };
}

function getPrimaryTradePickItems(items = []) {
  return (items || []).filter((item) => {
    if (item?.type !== "pick" || !item.pick) return false;
    if (item.tradeValueExcluded) return false;
    const rule = item.tradeRule || item.pick?.tradeRule || {};
    return !rule.mirror;
  });
}

function getSwapValue(item = {}, leagueData = {}, context = buildPickRankContext(leagueData)) {
  const rule = item.tradeRule || item.pick?.tradeRule || {};

  // TradePickSelect stores the displayed swap direction on the sending side.
  // Example: if the user offers "Swap Worst", the CPU receives the linked "Swap Best" upside.
  // For valuation, always price the right/obligation that the recipient is actually receiving.
  const senderDirection = String(rule.swapDirection || "best").toLowerCase() === "worst" ? "worst" : "best";
  const recipientDirection = inverseSwapDirection(senderDirection);
  const sourcePick = rule.sourcePick || item.pick || {};
  const recipientPick = rule.swapPick || {};

  const source = projectSinglePickValue({ type: "pick", pick: sourcePick, protection: "Unprotected" }, leagueData, context);
  const recipientBaseline = projectSinglePickValue({ type: "pick", pick: recipientPick, protection: "Unprotected" }, leagueData, context);
  const bestDelta = Math.max(source.value, recipientBaseline.value) - recipientBaseline.value;
  const worstDelta = Math.min(source.value, recipientBaseline.value) - recipientBaseline.value;

  let value = recipientDirection === "best" ? Math.max(0, bestDelta) : Math.min(0, worstDelta);
  let freeOptionFloorApplied = false;

  // A best-pick swap right can be nearly meaningless when the recipient already projects to have
  // the better pick, but it is still free optional upside. Give it a tiny positive value so the
  // no-downside path accepts it on its own, while keeping it far too small to pay for a player.
  if (recipientDirection === "best" && value < FREE_SWAP_OPTION_VALUE) {
    value = FREE_SWAP_OPTION_VALUE;
    freeOptionFloorApplied = true;
  }

  value = round4(value);

  const sender = displayTeamName(rule.fromTeamName || "sending side");
  const recipient = displayTeamName(rule.toTeamName || rule.swapRightHolder || "receiving side");
  const sourceLabel = displayTeamName(getPickOriginalTeam(sourcePick));
  const recipientLabel = displayTeamName(getPickOriginalTeam(recipientPick));
  const year = getPickYear(sourcePick, leagueData);
  const round = getPickRound(sourcePick);
  const optionalText = freeOptionFloorApplied
    ? " This is mostly a free optional right, so it receives only a tiny no-downside value."
    : "";

  return {
    value,
    sourceValue: source.value,
    baselineValue: recipientBaseline.value,
    senderDirection,
    recipientDirection,
    freeOptionFloorApplied,
    year,
    round,
    reason: `${recipient} receives ${swapDirectionLabel(recipientDirection)} swap value in ${year} ${formatRound(round)} worth ${value.toFixed(3)} from ${sender}'s ${swapDirectionLabel(senderDirection)} offer (${sourceLabel} ${source.value.toFixed(3)} vs ${recipientLabel} ${recipientBaseline.value.toFixed(3)}).${optionalText}`,
  };
}

function evaluatePickItemValue(item = {}, leagueData = {}, context = buildPickRankContext(leagueData)) {
  const rule = item.tradeRule || item.pick?.tradeRule || {};
  if (String(rule.action || "").toLowerCase() === "swap") {
    return getSwapValue(item, leagueData, context);
  }
  return projectSinglePickValue(item, leagueData, context);
}

function applyCpuSkew(value, side) {
  const n = Number(value || 0);
  if (side === "incoming") return round4(n >= 0 ? n * CPU_INCOMING_PICK_VALUE_MULT : n * CPU_OUTGOING_PICK_VALUE_MULT);
  return round4(n >= 0 ? n * CPU_OUTGOING_PICK_VALUE_MULT : n * CPU_INCOMING_PICK_VALUE_MULT);
}

function summarizeItem(itemValue, side) {
  const adjusted = applyCpuSkew(itemValue.value, side);
  return {
    ...itemValue,
    adjustedValue: adjusted,
    cpuSkewSide: side,
  };
}

export function evaluateTradePickImpact({ leagueData, userItems = [], cpuItems = [], userTeamName = "", cpuTeamName = "" } = {}) {
  const context = buildPickRankContext(leagueData);
  const incomingItems = getPrimaryTradePickItems(userItems);
  const outgoingItems = getPrimaryTradePickItems(cpuItems);
  const invalidSwapItems = [...incomingItems, ...outgoingItems].filter(
    (item) => isSwapTradeItem(item) && !swapTeamPairMatches(item, userTeamName, cpuTeamName)
  );
  const validIncomingItems = incomingItems.filter((item) => !invalidSwapItems.includes(item));
  const validOutgoingItems = outgoingItems.filter((item) => !invalidSwapItems.includes(item));
  const incoming = validIncomingItems.map((item) => summarizeItem(evaluatePickItemValue(item, leagueData, context), "incoming"));
  const outgoing = validOutgoingItems.map((item) => summarizeItem(evaluatePickItemValue(item, leagueData, context), "outgoing"));
  const incomingValue = round4(incoming.reduce((sum, item) => sum + Number(item.adjustedValue || 0), 0));
  const outgoingValue = round4(outgoing.reduce((sum, item) => sum + Number(item.adjustedValue || 0), 0));
  const netPickScore = round4(incomingValue - outgoingValue);

  const reasons = [];
  if (incoming.length) {
    const top = [...incoming].sort((a, b) => Math.abs(b.adjustedValue) - Math.abs(a.adjustedValue)).slice(0, 2);
    for (const item of top) reasons.push(`CPU receives pick asset: ${item.reason} CPU counts it as ${item.adjustedValue.toFixed(3)}.`);
  }
  if (outgoing.length) {
    const top = [...outgoing].sort((a, b) => Math.abs(b.adjustedValue) - Math.abs(a.adjustedValue)).slice(0, 2);
    for (const item of top) reasons.push(`CPU gives pick asset: ${item.reason} CPU treats losing it as ${item.adjustedValue.toFixed(3)}.`);
  }
  if (Math.abs(netPickScore) > TRADE_PICK_EPS) {
    reasons.unshift(`Net draft-pick value for CPU: ${netPickScore >= 0 ? "+" : ""}${netPickScore.toFixed(3)}.`);
  }

  const invalidSwapReasons = invalidSwapItems.map(
    (item) => `Stale swap ignored: ${describeSwapTeamPair(item)} is not between ${displayTeamName(userTeamName)} and ${displayTeamName(cpuTeamName)}.`
  );

  return {
    netPickScore,
    incomingValue,
    outgoingValue,
    incoming,
    outgoing,
    reasons,
    invalidSwaps: invalidSwapItems,
    invalidSwapReasons,
    hasPicks: incoming.length > 0 || outgoing.length > 0 || invalidSwapItems.length > 0,
  };
}

export function getTradePickValueDebug({ leagueData, item } = {}) {
  return evaluatePickItemValue(item, leagueData, buildPickRankContext(leagueData));
}
