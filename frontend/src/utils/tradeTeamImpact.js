import LZString from "lz-string";
import { computeTeamRatings } from "../api/teamRatings.js";
import {
  GAMEPLAN_VERSION,
  buildFullTeamRating,
  buildSmartRotation,
  calculateTeamPotentialRating,
} from "./ensureGameplans.js";
import { evaluateCpuContractFriction } from "./tradeContractValue.js";
import { evaluateTradePickImpact } from "./tradePickValue.js";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";

const TEAM_IMPACT_EPS = 0.015;
const NO_DOWNSIDE_MIN_GAIN = 0.10;
const CLEAN_PICK_UPGRADE_ACCEPT_LINE = 0.015;
const NO_DOWNSIDE_PICK_SWEETENER_LINE = 0.075;
const OVR_IMPACT_MULT = 10;
const POT_IMPACT_MULT = 7;
const FTR_FLAT_OVR_WINDOW = 0.15;
const FTR_TIEBREAKER_MULT = 0.45;
const BASE_ACCEPT_THRESHOLD = 0.85;
const TOP_CONFERENCE_THRESHOLD_TAX = 0.45;
const ELITE_TEAM_THRESHOLD_TAX = 0.10;
const RATING_CACHE_MAX = 250;
const POWER_CONTEXT_CACHE_MAX = 12;

const rosterRatingCache = new Map();
const rankOnlyRatingCache = new Map();
const powerContextCache = new Map();

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

function sameTeamName(a = "", b = "") {
  return normalizeName(a) === normalizeName(b);
}

function getTeamName(team = {}) {
  return team?.name || team?.teamName || team?.team || "";
}

function touchLimitedCache(cache, key, value, maxSize) {
  if (!key) return value;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);

  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  return value;
}

function getLimitedCache(cache, key) {
  if (!key || !cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
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

function gameplanRosterSignature(players = []) {
  return [...(players || [])]
    .map((p) =>
      [
        p?.name || p?.player || "",
        p?.pos || "",
        p?.secondaryPos || "",
        toNum(p?.overall ?? p?.ovr, 0),
      ].join("|")
    )
    .sort()
    .join("||");
}

function leaguePowerSignature(leagueData, teams = []) {
  const rosterPart = (teams || [])
    .map((team) => `${normalizeName(getTeamName(team))}:${rosterRatingSignature(team?.players || [])}`)
    .sort()
    .join("##");

  return [
    rosterPart,
    safeLocalStorageGet(RESULT_V3_INDEX_KEY) || "",
    safeLocalStorageGet(SCHEDULE_KEY) || "",
  ].join("::");
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamConferenceMap(leagueData, teams) {
  const map = {};

  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    for (const [conf, arr] of Object.entries(leagueData.conferences)) {
      for (const team of arr || []) {
        const name = getTeamName(team);
        if (name) map[name] = conf;
      }
    }
  }

  for (const team of teams || []) {
    const name = getTeamName(team);
    if (!name || map[name]) continue;
    map[name] = team?.conference || team?.conf || team?.divisionConference || "";
  }

  return map;
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

function parseSavedGameplan(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function namesSet(players = []) {
  return new Set(
    (players || [])
      .map((player) => player?.name || player?.player || "")
      .filter(Boolean)
  );
}

function setMatches(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function getCachedAutoMinutes(teamName, players = []) {
  const saved = parseSavedGameplan(safeLocalStorageGet(`gameplan_${teamName}`));
  if (!saved || saved.manualLocked || saved.userEdited || saved.source === "coach_gameplan") return null;
  if (saved.version !== GAMEPLAN_VERSION) return null;
  if (saved.teamName && teamName && !sameTeamName(saved.teamName, teamName)) return null;
  if (saved.rosterSignature !== gameplanRosterSignature(players)) return null;
  if (!saved.minutes || typeof saved.minutes !== "object") return null;

  const liveNames = namesSet(players);
  const minuteNames = new Set(Object.keys(saved.minutes || {}).filter(Boolean));
  if (!setMatches(liveNames, minuteNames)) return null;

  for (const name of minuteNames) {
    if (!Number.isFinite(Number(saved.minutes[name]))) return null;
  }

  return saved.minutes;
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
    if (!map[teamName]) {
      map[teamName] = { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    }
    return map[teamName];
  };

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.id) continue;

      const result = results?.[String(game.id)];
      if (!game.played && !result) continue;

      const homePts = toNum(result?.totals?.home ?? result?.winner?.home, NaN);
      const awayPts = toNum(result?.totals?.away ?? result?.winner?.away, NaN);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) continue;
      if (homePts === awayPts) continue;

      const homeName = game.home;
      const awayName = game.away;
      const home = ensure(homeName);
      const away = ensure(awayName);
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

function calculateTeamImpactRatings(players = []) {
  const valid = (players || []).filter((p) => p && (p.name || p.player) && Number.isFinite(Number(p.overall ?? p.ovr)));

  if (!valid.length) {
    return {
      exactOverall: 0,
      exactOff: 0,
      exactDef: 0,
      exactPot: 0,
      exactFtr: 0,
      displayOverall: 0,
      displayPot: 0,
      displayFtr: 0,
    };
  }

  let minutes = {};
  try {
    const built = buildSmartRotation(valid);
    minutes = built?.obj && typeof built.obj === "object" ? built.obj : {};
  } catch (error) {
    console.warn("Trade impact auto-rotation fallback:", error);
  }

  const teamRatings = computeTeamRatings({ players: valid }, minutes);
  const potentialRatings = calculateTeamPotentialRating(valid);
  const fullTeamRatings = buildFullTeamRating(valid);

  return {
    exactOverall: round4(teamRatings?.exactOverall ?? teamRatings?.overall ?? 0),
    exactOff: round4(teamRatings?.exactOff ?? teamRatings?.off ?? 0),
    exactDef: round4(teamRatings?.exactDef ?? teamRatings?.def ?? 0),
    exactPot: round4(potentialRatings?.exactPot ?? potentialRatings?.pot ?? 0),
    exactFtr: round4(fullTeamRatings?.exactFtr ?? fullTeamRatings?.ftr ?? 0),
    displayOverall: toNum(teamRatings?.overall, Math.round(teamRatings?.exactOverall || 0)),
    displayPot: toNum(potentialRatings?.pot, Math.round(potentialRatings?.exactPot || 0)),
    displayFtr: toNum(fullTeamRatings?.ftr, Math.round(fullTeamRatings?.exactFtr || 0)),
  };
}

function rateTeamRoster(players = []) {
  const key = `${GAMEPLAN_VERSION}:${rosterRatingSignature(players)}`;
  const cached = getLimitedCache(rosterRatingCache, key);
  if (cached) return cached;

  return touchLimitedCache(
    rosterRatingCache,
    key,
    calculateTeamImpactRatings(players),
    RATING_CACHE_MAX
  );
}

function calculateRankOnlyRatings(team = {}) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const valid = players.filter((p) => p && (p.name || p.player) && Number.isFinite(Number(p.overall ?? p.ovr)));

  if (!valid.length) {
    return { exactOverall: 0, exactOff: 0, exactDef: 0 };
  }

  let minutes = getCachedAutoMinutes(getTeamName(team), valid);

  if (!minutes) {
    try {
      const built = buildSmartRotation(valid);
      minutes = built?.obj && typeof built.obj === "object" ? built.obj : {};
    } catch (error) {
      console.warn("Trade power-rank auto-rotation fallback:", error);
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

function rateTeamForPowerRank(team = {}) {
  const key = `${GAMEPLAN_VERSION}:${normalizeName(getTeamName(team))}:${rosterRatingSignature(team?.players || [])}`;
  const cached = getLimitedCache(rankOnlyRatingCache, key);
  if (cached) return cached;

  return touchLimitedCache(
    rankOnlyRatingCache,
    key,
    calculateRankOnlyRatings(team),
    RATING_CACHE_MAX
  );
}

function buildPowerRankingRows(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const cacheKey = leaguePowerSignature(leagueData, teams);
  const cached = getLimitedCache(powerContextCache, cacheKey);
  if (cached) return cached;

  const records = buildRecordMap();
  const confMap = getTeamConferenceMap(leagueData, teams);

  const baseRows = teams.map((team) => {
    const name = getTeamName(team);
    const ratings = rateTeamForPowerRank(team);
    const record = records?.[name] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    const gp = toNum(record.gp, 0);
    const diff = toNum(record.pf, 0) - toNum(record.pa, 0);

    return {
      team,
      name,
      conference: confMap?.[name] || "",
      exactOverall: ratings.exactOverall,
      offDef: ratings.exactOff + ratings.exactDef,
      w: toNum(record.w, 0),
      l: toNum(record.l, 0),
      gp,
      winPct: gp > 0 ? toNum(record.w, 0) / gp : 0,
      pointDiff: gp > 0 ? diff / gp : 0,
    };
  });

  const useRecordPowerRankings = baseRows.length > 0 && baseRows.every((row) => row.gp >= 20);

  const rowsWithScores = baseRows.map((row) => {
    const recordScore = row.winPct * 100;
    const powerScore = useRecordPowerRankings
      ? row.exactOverall * 0.5 + recordScore * 0.5
      : row.exactOverall;

    return {
      ...row,
      recordScore,
      powerScore,
      useRecordPowerRankings,
    };
  });

  rowsWithScores.sort(
    (a, b) =>
      b.powerScore - a.powerScore ||
      (useRecordPowerRankings ? b.winPct - a.winPct : 0) ||
      b.exactOverall - a.exactOverall ||
      b.offDef - a.offDef ||
      b.pointDiff - a.pointDiff ||
      b.w - a.w ||
      String(a.name || "").localeCompare(String(b.name || ""))
  );

  const rankedRows = rowsWithScores.map((row, idx) => ({ ...row, rank: idx + 1 }));
  return touchLimitedCache(powerContextCache, cacheKey, rankedRows, POWER_CONTEXT_CACHE_MAX);
}

function getTeamPowerContext(leagueData, cpuTeamName) {
  const rows = buildPowerRankingRows(leagueData);
  const cpuRow = rows.find((row) => sameTeamName(row.name, cpuTeamName)) || null;
  const conference = cpuRow?.conference || "";
  const conferenceRows = rows.filter(
    (row) => String(row.conference || "").toLowerCase() === String(conference || "").toLowerCase()
  );
  const topConferenceRow = conferenceRows[0] || null;

  return {
    rows,
    rank: cpuRow?.rank || rows.length || 30,
    conference,
    isTopConferenceTeam: Boolean(cpuRow && topConferenceRow && sameTeamName(cpuRow.name, topConferenceRow.name)),
    useRecordPowerRankings: Boolean(cpuRow?.useRecordPowerRankings),
  };
}

function getOvrPotWeights(leagueRank = 15) {
  const rank = clamp(Number(leagueRank || 15), 1, 30);
  let ovrWeight;

  if (rank <= 12) {
    ovrWeight = 0.68 - ((rank - 1) / 11) * 0.18;
  } else if (rank <= 26) {
    ovrWeight = 0.50 - ((rank - 12) / 14) * 0.17;
  } else if (rank === 27) {
    ovrWeight = 0.35;
  } else if (rank === 28) {
    ovrWeight = 0.365;
  } else if (rank === 29) {
    ovrWeight = 0.38;
  } else {
    ovrWeight = 0.395;
  }

  ovrWeight = clamp(ovrWeight, 0.30, 0.70);
  return {
    ovrWeight: round4(ovrWeight),
    potWeight: round4(1 - ovrWeight),
  };
}

function getPlayerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null;
  if (id !== null && id !== undefined && String(id).trim() !== "") return `id:${String(id)}`;
  return `name:${normalizeName(player?.name || player?.player || "")}`;
}

function samePlayer(a = {}, b = {}) {
  const aid = getPlayerIdentity(a);
  const bid = getPlayerIdentity(b);
  return Boolean(aid && bid && aid === bid);
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...(value || {}) };
  }
}

function getTradePlayers(items = []) {
  return (items || [])
    .filter((item) => item?.type === "player" && item.player)
    .map((item) => item.player);
}

function getPrimaryTradePickItems(items = []) {
  return (items || []).filter((item) => {
    if (item?.type !== "pick" || !item.pick) return false;
    if (item.tradeValueExcluded) return false;
    const rule = item.tradeRule || item.pick?.tradeRule || {};
    return !rule.mirror;
  });
}

function buildCpuRosterAfterTrade(cpuTeam, userItems = [], cpuItems = [], cpuTeamName = "") {
  const outgoingPlayers = getTradePlayers(cpuItems);
  const incomingPlayers = getTradePlayers(userItems);

  const roster = (cpuTeam?.players || [])
    .filter((player) => !outgoingPlayers.some((outgoing) => samePlayer(player, outgoing)))
    .map(clonePlain);

  for (const incoming of incomingPlayers) {
    if (roster.some((row) => samePlayer(row, incoming))) continue;
    const moved = clonePlain(incoming);
    if (moved.teamName !== undefined) moved.teamName = cpuTeamName;
    if (moved.currentTeam !== undefined) moved.currentTeam = cpuTeamName;
    if (typeof moved.team === "string") moved.team = cpuTeamName;
    roster.push(moved);
  }

  return roster;
}

function getPickRound(pick = {}) {
  const round = Number(pick.round || pick.rnd || pick.pickRound || 0);
  if (round === 1 || round === 2) return round;
  const pickNumber = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.pick || 0);
  return pickNumber && pickNumber <= 30 ? 1 : 2;
}

function getPickSlot(item = {}) {
  const pick = item.pick || item || {};
  const values = [
    pick.pickNumber,
    pick.overallPick,
    pick.resolvedPickNumber,
    pick.projectedRank,
    pick.recordRank,
    pick.expectedRank,
    pick.slot,
  ];

  for (const value of values) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const rule = item.tradeRule || pick.tradeRule || {};
  const range = rule.conveyedRange || rule.ownedRange || pick.ownedRange || pick.ownedSlots || null;
  if (range) {
    const start = Number(range.start || 0);
    const end = Number(range.end || 0);
    if (start > 0 && end >= start) return (start + end) / 2;
  }

  return 0;
}

function genericPickValue(item = {}) {
  const pick = item.pick || item || {};
  const rule = item.tradeRule || pick.tradeRule || {};
  const round = getPickRound(pick);
  const slot = getPickSlot(item);
  const action = String(rule.action || "").toLowerCase();
  const protectionText = String(
    item.protection || pick.displayProtection || pick.protections || pick.protection || ""
  ).toLowerCase();

  if (action === "swap") {
    return round === 1 ? 0.18 : 0.05;
  }

  let value;
  if (round === 1) {
    if (slot > 0) {
      const firstRoundSlot = clamp(slot, 1, 30);
      value = 0.25 + ((30 - firstRoundSlot) / 29) * 1.3;
    } else {
      value = 0.65;
    }
  } else {
    if (slot > 0) {
      const secondRoundSlot = clamp(slot, 31, 60);
      value = 0.08 + ((60 - secondRoundSlot) / 29) * 0.18;
    } else {
      value = 0.14;
    }
  }

  if (action === "protected" || protectionText.includes("protected")) value *= 0.78;
  if (protectionText.includes("top 4") || protectionText.includes("top-4")) value *= 0.86;
  if (protectionText.includes("top 10") || protectionText.includes("top-10")) value *= 0.70;
  if (protectionText.includes("top 14") || protectionText.includes("top-14")) value *= 0.62;

  return round4(value);
}

function genericPickScoreForCpu(userItems = [], cpuItems = []) {
  const received = getPrimaryTradePickItems(userItems).reduce((sum, item) => sum + genericPickValue(item), 0);
  const sent = getPrimaryTradePickItems(cpuItems).reduce((sum, item) => sum + genericPickValue(item), 0);
  return round4(received - sent);
}

function formatDelta(value) {
  const n = Number(value || 0);
  const sign = n > TEAM_IMPACT_EPS ? "+" : "";
  return `${sign}${round4(n).toFixed(4)}`;
}

function makeRejectedResult(message, reasons = []) {
  return {
    accepted: false,
    decision: "reject",
    score: 0,
    message,
    reasons: reasons.length ? reasons : [message],
    counterSuggestions: [],
  };
}

export function evaluateTradeTeamImpact({ leagueData, userTeam, cpuTeam, userTeamName, cpuTeamName, userItems = [], cpuItems = [] }) {
  const cpuName = cpuTeamName || getTeamName(cpuTeam) || "CPU team";
  const userName = userTeamName || getTeamName(userTeam) || "Your team";

  if (!leagueData || !cpuTeam) {
    return makeRejectedResult("CPU evaluation failed because the CPU team could not be found.");
  }

  if (!userItems.length && !cpuItems.length) {
    return makeRejectedResult("Add at least one trade item before evaluation.");
  }

  const beforePlayers = Array.isArray(cpuTeam?.players) ? cpuTeam.players : [];
  const afterPlayers = buildCpuRosterAfterTrade(cpuTeam, userItems, cpuItems, cpuName);
  const before = rateTeamRoster(beforePlayers);
  const after = rateTeamRoster(afterPlayers);
  const powerContext = getTeamPowerContext(leagueData, cpuName);
  const { ovrWeight, potWeight } = getOvrPotWeights(powerContext.rank);

  const deltaOVR = round4(after.exactOverall - before.exactOverall);
  const deltaPOT = round4(after.exactPot - before.exactPot);
  const deltaFTR = round4(after.exactFtr - before.exactFtr);
  const positiveMovement = round4(Math.max(0, deltaOVR) + Math.max(0, deltaPOT) + Math.max(0, deltaFTR));
  const noDownsideMinGain = NO_DOWNSIDE_MIN_GAIN + (powerContext.isTopConferenceTeam ? 0.05 : 0);
  const pickImpact = evaluateTradePickImpact({
    leagueData,
    userItems,
    cpuItems,
    userTeamName: userName,
    cpuTeamName: cpuName,
  });

  if (Array.isArray(pickImpact?.invalidSwapReasons) && pickImpact.invalidSwapReasons.length > 0) {
    return makeRejectedResult(
      "Trade has a stale pick swap that does not match the current two teams.",
      [
        "Pick swaps are tied to the exact two negotiating teams. Switch teams again or clear/re-add the swap.",
        ...pickImpact.invalidSwapReasons,
      ]
    );
  }

  const pickScore = Number(pickImpact?.netPickScore || 0);
  const contractImpact = evaluateCpuContractFriction({
    leagueData,
    cpuIncomingPlayers: getTradePlayers(userItems),
    cpuOutgoingPlayers: getTradePlayers(cpuItems),
  });
  const hasNoMeaningfulDownside =
    deltaOVR >= -TEAM_IMPACT_EPS &&
    deltaPOT >= -TEAM_IMPACT_EPS &&
    deltaFTR >= -TEAM_IMPACT_EPS;

  let ftrScore = 0;
  if (Math.abs(deltaOVR) <= FTR_FLAT_OVR_WINDOW) {
    ftrScore = deltaFTR * FTR_TIEBREAKER_MULT;
  }

  const mainScore =
    ovrWeight * deltaOVR * OVR_IMPACT_MULT +
    potWeight * deltaPOT * POT_IMPACT_MULT +
    ftrScore +
    pickScore;

  const baseThreshold = round4(
    BASE_ACCEPT_THRESHOLD +
      (powerContext.isTopConferenceTeam ? TOP_CONFERENCE_THRESHOLD_TAX : 0) +
      (powerContext.rank <= 5 ? ELITE_TEAM_THRESHOLD_TAX : 0)
  );
  const threshold = round4(baseThreshold + Number(contractImpact?.friction || 0));

  const hasPlayerMovement = getTradePlayers(userItems).length > 0 || getTradePlayers(cpuItems).length > 0;
  const hasMeaningfulContractFriction = Number(contractImpact?.friction || 0) > 0.035;
  const cleanPickUpgradeAccept =
    !hasPlayerMovement &&
    !hasMeaningfulContractFriction &&
    pickScore >= CLEAN_PICK_UPGRADE_ACCEPT_LINE;
  const noDownsidePickSweetenerAccept =
    hasNoMeaningfulDownside &&
    !hasMeaningfulContractFriction &&
    pickScore >= NO_DOWNSIDE_PICK_SWEETENER_LINE;
  const noDownsideAccept =
    hasNoMeaningfulDownside &&
    positiveMovement >= noDownsideMinGain &&
    pickScore >= -TEAM_IMPACT_EPS &&
    mainScore >= threshold - 0.25;
  const tradeoffAccept = mainScore >= threshold;
  const accepted = Boolean(cleanPickUpgradeAccept || noDownsidePickSweetenerAccept || noDownsideAccept || tradeoffAccept);

  const reasons = [
    `${cpuName} power rank #${powerContext.rank}: values OVR ${(ovrWeight * 100).toFixed(1)}% / POT ${(potWeight * 100).toFixed(1)}%.`,
    `Before trade: OVR ${before.exactOverall.toFixed(4)}, POT ${before.exactPot.toFixed(4)}, FTR ${before.exactFtr.toFixed(4)}.`,
    `After trade: OVR ${after.exactOverall.toFixed(4)}, POT ${after.exactPot.toFixed(4)}, FTR ${after.exactFtr.toFixed(4)}.`,
    `Team impact: OVR ${formatDelta(deltaOVR)}, POT ${formatDelta(deltaPOT)}, FTR ${formatDelta(deltaFTR)}.`,
  ];

  if (Array.isArray(pickImpact?.reasons) && pickImpact.reasons.length > 0) {
    reasons.push(...pickImpact.reasons.slice(0, 5));
  }

  if (Array.isArray(contractImpact?.reasons) && contractImpact.reasons.length > 0) {
    reasons.push(...contractImpact.reasons);
  }

  if (powerContext.isTopConferenceTeam) {
    reasons.push(`${cpuName} is currently the top team in its conference, so it needs a clearer reason to move pieces.`);
  }

  if (cleanPickUpgradeAccept) {
    reasons.push("Accepted because this is a clean draft-asset upgrade for the CPU with no player, roster, salary, or contract downside.");
  } else if (noDownsidePickSweetenerAccept) {
    reasons.push("Accepted because the CPU receives enough draft-pick value without taking a meaningful team-impact or contract downside.");
  } else if (noDownsideAccept) {
    reasons.push("Accepted because the trade improves or holds every team-impact rating and stays close enough to the contract-adjusted threshold.");
  } else if (accepted) {
    reasons.push(`Accepted because the weighted team-impact score clears the ${threshold.toFixed(2)} contract-adjusted threshold.`);
  } else if (!hasNoMeaningfulDownside) {
    reasons.push(`Rejected because the gains do not justify the rating sacrifice for ${cpuName}'s current team direction.`);
  } else if (pickImpact?.hasPicks && pickScore < CLEAN_PICK_UPGRADE_ACCEPT_LINE) {
    reasons.push(
      pickScore < -TEAM_IMPACT_EPS
        ? `Rejected because ${cpuName} would lose net draft-pick value in a deal without enough team-impact compensation.`
        : `Rejected because the draft-pick value is too small to justify anything beyond a no-downside asset cleanup.`
    );
  } else {
    reasons.push("Rejected because the move is too close to neutral; CPU teams need a clear reason to trade.");
  }

  return {
    accepted,
    decision: accepted ? "accept" : "reject",
    score: round4(mainScore),
    message: accepted
      ? `${cpuName} accepts the proposal.`
      : `${cpuName} rejects the proposal.`,
    reasons,
    counterSuggestions: [],
    teamImpact: {
      userTeamName: userName,
      cpuTeamName: cpuName,
      rank: powerContext.rank,
      isTopConferenceTeam: powerContext.isTopConferenceTeam,
      useRecordPowerRankings: powerContext.useRecordPowerRankings,
      weights: { ovrWeight, potWeight },
      threshold,
      baseThreshold,
      contractFriction: contractImpact?.friction || 0,
      contractImpact,
      noDownsideMinGain,
      before,
      after,
      deltas: {
        ovr: deltaOVR,
        pot: deltaPOT,
        ftr: deltaFTR,
      },
      scoreBreakdown: {
        ovrScore: round4(ovrWeight * deltaOVR * OVR_IMPACT_MULT),
        potScore: round4(potWeight * deltaPOT * POT_IMPACT_MULT),
        ftrScore: round4(ftrScore),
        pickScore,
        pickImpact,
        incomingPickValue: pickImpact?.incomingValue || 0,
        outgoingPickValue: pickImpact?.outgoingValue || 0,
        cleanPickUpgradeAccept,
        noDownsidePickSweetenerAccept,
        contractFriction: contractImpact?.friction || 0,
      },
    },
  };
}
