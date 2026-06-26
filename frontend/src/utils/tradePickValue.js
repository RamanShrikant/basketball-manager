import LZString from "lz-string";
import { computeTeamRatings } from "../api/teamRatings.js";
import {
  buildSmartRotation,
  calculateTeamPotentialRating,
} from "./ensureGameplans.js";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";

const CPU_INCOMING_PICK_VALUE_MULT = 1.06;
const CPU_OUTGOING_PICK_VALUE_MULT = 1.125;

const YEAR_BLEND_BY_OFFSET = [
  // 2025-26 starts with 2026 draft picks. Offset 0 means the current draft class.
  // Current-year picks should mostly follow Power Ranking order. Future picks slowly
  // shift toward POT / long-term outlook without creating hard lottery cliffs.
  { power: 1.0, pot: 0.0, certainty: 1.0 },
  { power: 0.82, pot: 0.18, certainty: 0.985 },
  { power: 0.66, pot: 0.34, certainty: 0.97 },
  { power: 0.50, pot: 0.50, certainty: 0.955 },
  { power: 0.36, pot: 0.64, certainty: 0.94 },
  { power: 0.24, pot: 0.76, certainty: 0.925 },
  { power: 0.14, pot: 0.86, certainty: 0.91 },
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
  // These values are trade-score units. This scale intentionally makes firsts
  // feel like real NBA trade capital: bad-team firsts can bridge starter-level
  // gaps, mid firsts matter, and late firsts are more than tiny throw-ins.
  1: 8.9, 2: 8.3, 3: 7.75, 4: 7.2, 5: 6.65,
  6: 6.15, 7: 5.7, 8: 5.25, 9: 4.85, 10: 4.5,
  11: 4.15, 12: 3.8, 13: 3.5, 14: 3.2, 15: 2.9,
  16: 2.65, 17: 2.43, 18: 2.23, 19: 2.05, 20: 1.88,
  21: 1.72, 22: 1.58, 23: 1.45, 24: 1.33, 25: 1.22,
  26: 1.12, 27: 1.03, 28: 0.95, 29: 0.88, 30: 0.82,
};

const SECOND_SLOT_VALUE = {
  // Seconds are still sweeteners, but early seconds should be real assets.
  31: 0.68, 32: 0.64, 33: 0.6, 34: 0.55, 35: 0.51,
  36: 0.47, 37: 0.43, 38: 0.39, 39: 0.36, 40: 0.33,
  41: 0.3, 42: 0.275, 43: 0.25, 44: 0.228, 45: 0.208,
  46: 0.19, 47: 0.173, 48: 0.157, 49: 0.143, 50: 0.13,
  51: 0.118, 52: 0.107, 53: 0.097, 54: 0.088, 55: 0.08,
  56: 0.073, 57: 0.066, 58: 0.06, 59: 0.054, 60: 0.049,
};

const TRADE_PICK_EPS = 0.005;
const FREE_SWAP_OPTION_VALUE = 0.04;

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
    leagueData?.draftYear,
    leagueData?.currentDraftYear,
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  let current = candidates.length ? Math.max(...candidates) : 2026;

  // The game begins in the 2025-26 season with 2026 picks available. Some saves
  // may store only seasonStartYear = 2025, so use the earliest active draft asset
  // as the current draft year when needed. After a season rolls, 2033 is added
  // and the old draft year is removed, so this also follows the rolling window.
  const activePickYears = (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [])
    .filter((row) => !["void", "deleted", "removed", "inactive"].includes(String(row?.status || "active").toLowerCase()))
    .map((row) => Number(row?.year || row?.seasonYear || 0))
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);
  const minActivePickYear = activePickYears.length ? Math.min(...activePickYears) : 0;

  if (minActivePickYear && current < minActivePickYear) current = minActivePickYear;

  return current;
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

function protectionTextToConveyedRange(text = "", round = 1) {
  const full = getFullSlotRange(round);
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === "none" || lower === "null" || lower.includes("unprotected")) return null;

  const ownsMatch = raw.match(/\bowns\s*#?\s*(\d{1,2})\s*-\s*#?\s*(\d{1,2})\b/i);
  if (ownsMatch) {
    return normalizeRange({ start: Number(ownsMatch[1]), end: Number(ownsMatch[2]) }, round);
  }

  const topMatch = raw.match(/\btop\s*(\d{1,2})\s*protected\b/i);
  if (topMatch) {
    const protectedEnd = clamp(Number(topMatch[1]), full.start - 1, full.end);
    if (protectedEnd >= full.end) return { start: full.end, end: full.end };
    return normalizeRange({ start: protectedEnd + 1, end: full.end }, round);
  }

  if (/\blottery\s*protected\b/i.test(raw) || /\btop\s*14\b/i.test(raw)) {
    const protectedEnd = Number(round) === 1 ? 14 : 44;
    return normalizeRange({ start: protectedEnd + 1, end: full.end }, round);
  }

  const rangeProtected = raw.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*protected\b/i);
  if (rangeProtected) {
    const protectedEnd = clamp(Number(rangeProtected[2]), full.start - 1, full.end);
    if (protectedEnd >= full.end) return { start: full.end, end: full.end };
    return normalizeRange({ start: protectedEnd + 1, end: full.end }, round);
  }

  return null;
}

function getRangeFromItem(item = {}, round = 1) {
  const pick = item.pick || item || {};
  const rule = item.tradeRule || pick.tradeRule || {};
  const pickNumber = getPickNumber(pick);
  if (pickNumber > 0) return { start: pickNumber, end: pickNumber };

  const protectionText = [
    item.protection,
    pick.displayProtection,
    pick.protections,
    pick.protection,
    pick.conditions,
    pick.notes,
  ]
    .filter(Boolean)
    .join(" | ");

  const explicitCandidate =
    rule.conveyedRange ||
    pick.conveyedRange ||
    null;
  if (explicitCandidate) return normalizeRange(explicitCandidate, round);

  const ownedCandidate =
    rule.ownedRange ||
    pick.ownedRange ||
    pick.ownedSlots ||
    null;
  if (ownedCandidate) {
    const owned = normalizeRange(ownedCandidate, round);
    const full = getFullSlotRange(round);
    const textRange = protectionTextToConveyedRange(protectionText, round);
    const ownedIsFull = owned.start === full.start && owned.end === full.end;
    if (textRange && ownedIsFull) return textRange;
    return owned;
  }

  return protectionTextToConveyedRange(protectionText, round) || getFullSlotRange(round);
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
  const blendedRank = clamp(powerRank * power + potRank * pot, 1, 30);
  const pickNumber = getPickNumber(pick);
  const expectedSlot = pickNumber || expectedSlotFromRank(blendedRank, round, offset);
  const range = getRangeFromItem(item, round);
  const rangeModel = distributionExpectedSlotValue({ round, expectedSlot, yearOffset: offset, range });

  // Core pick value now comes from expected landing area, not a generic pick label.
  // For protected picks, rangedSlotValue is weighted across only the slots the
  // receiving team can actually get. That means a top-5 protected bad-team first
  // loses the #1-5 upside and can only be valued from #6 onward.
  const rawUnprotectedValue = pickNumber
    ? slotValue(round, pickNumber) * certainty
    : rangeModel.fullSlotValue * certainty;
  const value = round4(pickNumber ? rawUnprotectedValue : rangeModel.rangedSlotValue * certainty);
  const effectiveRangeRatio = pickNumber ? 1 : rangeModel.ratio;
  const effectiveConveyanceChance = pickNumber ? 1 : rangeModel.conveyanceChance;
  const protectionText = String(item.protection || pick.displayProtection || pick.protections || pick.protection || "Unprotected");
  const normalizedRange = normalizeRange(range, round);
  const fullRange = getFullSlotRange(round);
  const rangeIsFull = normalizedRange.start === fullRange.start && normalizedRange.end === fullRange.end;
  const rankSource = offset === 0 ? `Power Rank #${powerRank}` : `Power Rank #${powerRank} / POT Rank #${potRank}`;
  const blendLabel = offset === 0 ? "current-year Power Ranking" : `${Math.round(power * 100)}% Power Ranking / ${Math.round(pot * 100)}% POT`;
  const originalLabel = displayTeamName(originalTeam);
  const protectionNote = rangeIsFull
    ? ""
    : `, ${(effectiveConveyanceChance * 100).toFixed(0)}% expected conveyance, best conveyable ${formatRange(range, round)}`;
  const reason = `${pickYear} ${originalLabel} ${formatRound(round)} valued at ${value.toFixed(3)} (${rankSource}, ${blendLabel}, expected pick #${round4(expectedSlot).toFixed(2)}, ${formatRange(range, round)}${protectionNote}).`;

  return {
    value,
    rawUnprotectedValue: round4(rawUnprotectedValue),
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

function pickAssetType(pick = {}) {
  return String(pick?.assetType || pick?.type || "pick").toLowerCase();
}

function getSwapAssetDirection(asset = {}) {
  const text = String(
    asset?.protection ||
      asset?.displayProtection ||
      asset?.protections ||
      asset?.protectionType ||
      asset?.conditions ||
      ""
  ).toLowerCase();
  return text.includes("worst") ? "worst" : "best";
}

function getSwapParticipantTeams(asset = {}) {
  const details = asset?.realLifeDetails || {};
  const participants = Array.isArray(details.swapParticipants)
    ? details.swapParticipants
    : Array.isArray(asset?.swapParticipants)
    ? asset.swapParticipants
    : [];

  const out = [];
  const push = (value) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    if (!out.some((row) => sameTeamName(row, clean))) out.push(clean);
  };

  for (const team of participants) push(team);
  push(asset.originalTeam || asset.originalTeamName || asset.team || asset.teamName);
  push(asset.swapWithTeam || asset.swap_with_team || asset.swapTeam || asset.otherTeam || asset.swap?.withTeam);

  return out.slice(0, 2);
}

function buildSyntheticPick(originalTeam, basePick = {}) {
  return {
    ...basePick,
    assetType: "pick",
    type: "pick",
    originalTeam,
    originalTeamName: originalTeam,
    teamName: originalTeam,
    ownerTeam: originalTeam,
    protection: "Unprotected",
    protections: "Unprotected",
    displayProtection: "Unprotected",
  };
}

function getExistingSwapValue(item = {}, leagueData = {}, context = buildPickRankContext(leagueData)) {
  const pick = item.pick || item || {};
  const participants = getSwapParticipantTeams(pick);
  const direction = getSwapAssetDirection({ ...pick, protection: item.protection || pick.protection });
  const year = getPickYear(pick, leagueData);
  const round = getPickRound(pick);

  if (participants.length < 2) {
    return {
      value: 0,
      year,
      round,
      recipientDirection: direction,
      reason: `${year} ${formatRound(round)} swap could not be valued because the two involved picks were not clear.`,
    };
  }

  const [teamA, teamB] = participants;
  const pickA = projectSinglePickValue({ type: "pick", pick: buildSyntheticPick(teamA, pick), protection: "Unprotected" }, leagueData, context);
  const pickB = projectSinglePickValue({ type: "pick", pick: buildSyntheticPick(teamB, pick), protection: "Unprotected" }, leagueData, context);
  const holder = displayTeamName(item.teamName || pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "right holder");

  // Existing swap assets are already actual draft rights in your save file.
  // Trading away "Swap Best" means trading away the expected better pick in
  // that two-pick group, not merely trading away the small upgrade over the
  // holder's natural pick. Newly-created swap proposals still use upgrade-only
  // value in getSwapValue(); this full-asset valuation is only for existing
  // tradable swap assets.
  const bestValue = Math.max(pickA.value, pickB.value);
  const worstValue = Math.min(pickA.value, pickB.value);
  const value = round4(direction === "best" ? bestValue : worstValue);

  return {
    value,
    sourceValue: pickA.value,
    baselineValue: pickB.value,
    otherValue: pickB.value,
    recipientDirection: direction,
    year,
    round,
    freeOptionFloorApplied: false,
    existingSwapAssetFullValue: true,
    reason: `${holder} owns existing ${swapDirectionLabel(direction)} swap rights in ${year} ${formatRound(round)} between ${displayTeamName(teamA)} (${pickA.value.toFixed(3)}) and ${displayTeamName(teamB)} (${pickB.value.toFixed(3)}), so the asset is valued as the expected ${direction === "best" ? "better" : "worse"} pick at ${value.toFixed(3)}.`,
  };
}

function getSwapValue(item = {}, leagueData = {}, context = buildPickRankContext(leagueData)) {
  const rule = item.tradeRule || item.pick?.tradeRule || {};

  if (String(rule.action || "").toLowerCase() !== "swap") {
    return getExistingSwapValue(item, leagueData, context);
  }

  // TradePickSelect creates one primary swap item on the sending side. The rule's
  // swapDirection is the exact right/obligation the receiving side gets when the
  // trade is completed, matching buildTradeMachineSwapAssets in draftPicks.js.
  const recipientDirection = String(rule.swapDirection || "best").toLowerCase() === "worst" ? "worst" : "best";
  const sourcePick = rule.sourcePick || item.pick || {};
  const recipientPick = rule.swapPick || {};

  const source = projectSinglePickValue({ type: "pick", pick: sourcePick, protection: "Unprotected" }, leagueData, context);
  const recipientBaseline = projectSinglePickValue({ type: "pick", pick: recipientPick, protection: "Unprotected" }, leagueData, context);
  const bestDelta = Math.max(source.value, recipientBaseline.value) - recipientBaseline.value;
  const worstDelta = Math.min(source.value, recipientBaseline.value) - recipientBaseline.value;

  let value = recipientDirection === "best" ? Math.max(0, bestDelta) : Math.min(0, worstDelta);
  let freeOptionFloorApplied = false;

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
    recipientDirection,
    freeOptionFloorApplied,
    year,
    round,
    reason: `${recipient} receives ${swapDirectionLabel(recipientDirection)} swap value in ${year} ${formatRound(round)} worth ${value.toFixed(3)} from ${sender}'s offer (${sourceLabel} ${source.value.toFixed(3)} vs ${recipientLabel} ${recipientBaseline.value.toFixed(3)}).${optionalText}`,
  };
}

function evaluatePickItemValue(item = {}, leagueData = {}, context = buildPickRankContext(leagueData)) {
  const rule = item.tradeRule || item.pick?.tradeRule || {};
  const pick = item.pick || item || {};
  const label = String(item.protection || pick.displayProtection || pick.protections || pick.protection || "").toLowerCase();
  const isSwapItem =
    String(rule.action || "").toLowerCase() === "swap" ||
    pickAssetType(pick) === "swap" ||
    label.includes("swap best") ||
    label.includes("swap worst");

  if (isSwapItem) return getSwapValue(item, leagueData, context);
  return projectSinglePickValue(item, leagueData, context);
}

function getCpuPickDirectionMultiplier(context, cpuTeamName = "") {
  const row = context?.byTeam?.get?.(normalizeName(cpuTeamName)) || null;
  const rank = clamp(Number(row?.powerRank || 15), 1, 30);
  // Rebuilders treat picks as more important. Contenders discount pick assets
  // because active OVR upgrades matter more to them right now.
  return round4(clamp(0.86 + ((rank - 1) / 29) * 0.44, 0.86, 1.30));
}

function applyCpuSkew(value, side, directionMultiplier = 1) {
  const n = Number(value || 0);
  const skew = side === "incoming"
    ? (n >= 0 ? CPU_INCOMING_PICK_VALUE_MULT : CPU_OUTGOING_PICK_VALUE_MULT)
    : (n >= 0 ? CPU_OUTGOING_PICK_VALUE_MULT : CPU_INCOMING_PICK_VALUE_MULT);
  return round4(n * skew * Number(directionMultiplier || 1));
}

function summarizeItem(itemValue, side, directionMultiplier = 1) {
  const adjusted = applyCpuSkew(itemValue.value, side, directionMultiplier);
  return {
    ...itemValue,
    adjustedValue: adjusted,
    cpuSkewSide: side,
    cpuPickDirectionMultiplier: round4(directionMultiplier),
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
  const directionMultiplier = getCpuPickDirectionMultiplier(context, cpuTeamName);
  const incoming = validIncomingItems.map((item) => summarizeItem(evaluatePickItemValue(item, leagueData, context), "incoming", directionMultiplier));
  const outgoing = validOutgoingItems.map((item) => summarizeItem(evaluatePickItemValue(item, leagueData, context), "outgoing", directionMultiplier));
  const incomingValue = round4(incoming.reduce((sum, item) => sum + Number(item.adjustedValue || 0), 0));
  const outgoingValue = round4(outgoing.reduce((sum, item) => sum + Number(item.adjustedValue || 0), 0));
  const netPickScore = round4(incomingValue - outgoingValue);

  const reasons = [];
  if (incoming.length || outgoing.length) {
    reasons.push(`CPU draft-pick direction multiplier: ${directionMultiplier.toFixed(3)} (${displayTeamName(cpuTeamName)} values picks ${directionMultiplier >= 1 ? "more" : "less"} based on current Power Rank).`);
  }
  if (incoming.length) {
    const top = [...incoming].sort((a, b) => Math.abs(b.adjustedValue) - Math.abs(a.adjustedValue)).slice(0, 3);
    for (const item of top) reasons.push(`CPU receives pick asset: ${item.reason} CPU counts it as ${item.adjustedValue.toFixed(3)}.`);
  }
  if (outgoing.length) {
    const top = [...outgoing].sort((a, b) => Math.abs(b.adjustedValue) - Math.abs(a.adjustedValue)).slice(0, 3);
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
    cpuPickDirectionMultiplier: directionMultiplier,
    hasPicks: incoming.length > 0 || outgoing.length > 0 || invalidSwapItems.length > 0,
  };
}

export function getTradePickValueDebug({ leagueData, item } = {}) {
  return evaluatePickItemValue(item, leagueData, buildPickRankContext(leagueData));
}
