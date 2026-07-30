import {
  executeCpuTradeCandidateOnLeague,
  validateCpuTradeCandidateOnLeague,
} from "./tradeExecution.js";
import { normalizeTeamName } from "./draftPicks.js";
import {
  validateCpuTradeCandidatesParallel,
} from "../api/cpuTradeValidationPool.js";
import {
  CPU_TRADE_CONTINUOUS_MAX_TARGET,
  CPU_TRADE_CONTINUOUS_MIN_TARGET,
  decideContinuousMarketGeneration,
  getContinuousMarketBudgets,
  getContinuousMarketMinimumTrades,
} from "./cpuTradeContinuousMarket.js";
import {
  cpuTradeNow,
  isCpuTradeDeepTraceEnabled,
  recordCpuTradeTiming,
  recordCpuTradeTrace,
  recordCpuTradeValidation,
} from "./cpuTradeTelemetry.js";

export const CPU_TRADE_BANK_FIELD = "cpuTradeBankState";
export const CPU_TRADE_BANK_VERSION = 12;
export const CPU_TRADE_BANK_TEST_CONFIG_KEY = "bm_cpu_trade_bank_test_config_v1";

const TARGET_MIN = CPU_TRADE_CONTINUOUS_MIN_TARGET;
const TARGET_MAX = CPU_TRADE_CONTINUOUS_MAX_TARGET;
const MAX_BANK_SIZE = 48;
const MAX_BANK_ENTRIES_PER_TEAM = 3;
const FIRST_EXECUTION_DAY = 1;
const MAX_GENERATION_CANDIDATES_PER_PASS = 120;
const MAX_EXACT_EVALUATIONS_PER_PASS = 72;
const MAX_SAME_STATE_VALIDATION_CACHE = 512;

let activeSameStateValidationCacheScope = "";
const sameStateValidationCache = new Map();
const objectIdentityTokens = new WeakMap();
let nextObjectIdentityToken = 1;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSeasonYear(leagueData = {}, context = {}) {
  return Math.trunc(
    finiteNumber(
      context?.seasonYear ??
        leagueData?.seasonYear ??
        leagueData?.currentSeasonYear ??
        leagueData?.seasonStartYear,
      2026
    )
  );
}

function getAllTeams(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams;
  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    return Object.values(leagueData.conferences).flat().filter(Boolean);
  }
  return [];
}

function teamNameOf(team = {}) {
  return team?.name || team?.teamName || team?.team || "";
}

function sameTeam(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function resolveTeamNameValue(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";

  return String(
    value?.name ||
      value?.teamName ||
      value?.team ||
      value?.franchiseName ||
      value?.abbreviation ||
      ""
  ).trim();
}

function getContextUserTeamName(context = {}, leagueData = {}) {
  const candidates = [
    context?.userTeamName,
    context?.selectedTeam,
    leagueData?.selectedTeam,
    leagueData?.userTeam,
    leagueData?.controlledTeam,
    leagueData?.selectedTeamName,
    leagueData?.userTeamName,
    leagueData?.controlledTeamName,
  ];

  for (const candidate of candidates) {
    const name = resolveTeamNameValue(candidate);
    if (name) return name;
  }

  return "";
}

function candidateInvolvesTeam(candidate = {}, teamName = "") {
  if (!teamName) return false;
  return (
    sameTeam(candidate?.fromTeamName, teamName) ||
    sameTeam(candidate?.toTeamName, teamName)
  );
}

function hashString(value = "") {
  let hash = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function objectIdentityToken(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return "primitive";
  }
  if (!objectIdentityTokens.has(value)) {
    objectIdentityTokens.set(value, nextObjectIdentityToken++);
  }
  return objectIdentityTokens.get(value);
}

function recordsFingerprint(recordsByTeam = {}) {
  return hashString(
    Object.entries(recordsByTeam || {})
      .map(([teamName, row]) => {
        const values = Object.entries(row || {})
          .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}:${String(value)}`)
          .join(",");
        return `${normalizeTeamName(teamName)}:${values}`;
      })
      .sort()
      .join("|")
  ).toString(16);
}

function buildSameStateValidationCacheScope(leagueData = {}, context = {}, state = {}) {
  const teamContainer = leagueData?.conferences || leagueData?.teams || leagueData;
  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  const draftPicks = Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [];
  return [
    getSeasonYear(leagueData, context),
    context?.currentDate || context?.generatedDate || "",
    context?.tradeDeadlineDate || "",
    context?.inOffseason ? "offseason" : "regular",
    normalizeTeamName(getContextUserTeamName(context, leagueData)),
    finiteNumber(state?.completedTrades, 0),
    history.length,
    draftPicks.length,
    objectIdentityToken(teamContainer),
    objectIdentityToken(history),
    objectIdentityToken(draftPicks),
    recordsFingerprint(context?.recordsByTeam || {}),
  ].join("|");
}

function prepareSameStateValidationCache(scope = "") {
  if (scope === activeSameStateValidationCacheScope) return;
  activeSameStateValidationCacheScope = scope;
  sameStateValidationCache.clear();
}

function rememberSameStateValidation(signature, validation = null) {
  if (!signature || !validation || typeof validation !== "object") return;
  sameStateValidationCache.set(signature, validation);
  while (sameStateValidationCache.size > MAX_SAME_STATE_VALIDATION_CACHE) {
    const oldestKey = sameStateValidationCache.keys().next().value;
    if (!oldestKey) break;
    sameStateValidationCache.delete(oldestKey);
  }
}

function seededRandom(seed = "") {
  let state = hashString(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(rows = [], seed = "") {
  const out = [...rows];
  const random = seededRandom(seed);
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [out[index], out[swapIndex]] = [out[swapIndex], out[index]];
  }
  return out;
}

function randomSeedToken(seasonYear, overrideSeed = "") {
  if (overrideSeed) return `test:${overrideSeed}:${seasonYear}`;

  try {
    if (globalThis?.crypto?.getRandomValues) {
      const values = new Uint32Array(4);
      globalThis.crypto.getRandomValues(values);
      return `save:${seasonYear}:${Array.from(values).map((value) => value.toString(16)).join("")}`;
    }
  } catch {}

  return `save:${seasonYear}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function countCpuTradesForSeason(leagueData = {}, seasonYear) {
  return (Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : []).filter((row) => {
    if (!row || !(row.cpuCpuTrade || row.source === "cpu_cpu_trade")) return false;
    const rowSeason = Math.trunc(finiteNumber(row.seasonYear, seasonYear));
    return rowSeason === seasonYear;
  }).length;
}

function leagueTeamFingerprint(leagueData = {}) {
  return getAllTeams(leagueData)
    .map((team) => normalizeTeamName(teamNameOf(team)))
    .filter(Boolean)
    .sort()
    .join("|");
}

function makeStats(existing = {}) {
  return {
    generationPasses: finiteNumber(existing.generationPasses, 0),
    proposedCandidates: finiteNumber(existing.proposedCandidates, 0),
    exactEvaluations: finiteNumber(existing.exactEvaluations, 0),
    cachedAdmissionRejections: finiteNumber(existing.cachedAdmissionRejections, 0),
    sameStateValidationCacheHits: finiteNumber(existing.sameStateValidationCacheHits, 0),
    sameStateAdmissionCacheHits: finiteNumber(existing.sameStateAdmissionCacheHits, 0),
    sameStatePeriodicCacheHits: finiteNumber(existing.sameStatePeriodicCacheHits, 0),
    recordSnapshotValidationCalls: finiteNumber(existing.recordSnapshotValidationCalls, 0),
    acceptedIntoBank: finiteNumber(existing.acceptedIntoBank, 0),
    duplicateCandidates: finiteNumber(existing.duplicateCandidates, 0),
    rejectedCandidates: finiteNumber(existing.rejectedCandidates, 0),
    staleCandidatesRemoved: finiteNumber(existing.staleCandidatesRemoved, 0),
    executionAttempts: finiteNumber(existing.executionAttempts, 0),
    executionDeferrals: finiteNumber(existing.executionDeferrals, 0),
    completedTrades: finiteNumber(existing.completedTrades, 0),
    dryRuns: finiteNumber(existing.dryRuns, 0),
    processingMs: finiteNumber(existing.processingMs, 0),
    rejectionReasons:
      existing?.rejectionReasons && typeof existing.rejectionReasons === "object"
        ? { ...existing.rejectionReasons }
        : {},
    lastGeneration: existing?.lastGeneration || null,
    lastExecution: existing?.lastExecution || null,
  };
}

function bumpReason(stats, code = "unknown") {
  const key = String(code || "unknown");
  stats.rejectionReasons[key] = finiteNumber(stats.rejectionReasons[key], 0) + 1;
}

function buildExecutionPlan({ seed, targetTrades, firstDay, deadlineDay }) {
  const start = Math.max(FIRST_EXECUTION_DAY, Math.trunc(finiteNumber(firstDay, FIRST_EXECUTION_DAY)));
  const end = Math.max(start, Math.trunc(finiteNumber(deadlineDay, start + 100)) - 1);
  const allDays = [];

  for (let day = start; day <= end; day += 1) {
    const progress = (day - start) / Math.max(1, end - start);
    // Keep the season target intact, but shape it like a real market:
    // a few light preseason/pre-opener moves, a quiet early/midseason trickle,
    // then a deadline ramp. This prevents the old huge deadline-only cluster and
    // makes Oct. 1 -> opening night useful without adding extra sim-loop work.
    const preseasonLift = progress <= 0.12 ? 2.4 * (1 - progress / 0.12) : 0;
    const midseasonBase = 0.42 + 0.28 * progress;
    const deadlineLift = Math.pow(progress, 2.35) * 2.0;
    const weight = midseasonBase + preseasonLift + deadlineLift;
    allDays.push({ day, weight });
  }

  const random = seededRandom(`${seed}|execution-plan`);
  const selected = [];
  const desired = Math.min(Math.max(0, targetTrades), allDays.length);
  const used = new Set();
  const finalWindowStart = Math.max(start, end - 16);
  const preseasonWindowEnd = Math.min(end, start + 20);
  const preseasonReserve = Math.min(
    desired,
    Math.max(
      Math.min(3, desired),
      Math.round(desired * 0.18)
    )
  );
  const deadlineReserve = Math.min(
    Math.max(0, desired - preseasonReserve),
    Math.max(
      Math.min(3, desired),
      Math.round(desired * (desired >= 32 ? 0.20 : 0.16))
    )
  );

  function weightedTake(pool, count) {
    const local = [...pool].filter((row) => !used.has(row.day));
    const out = [];
    while (out.length < count && local.length) {
      const totalWeight = local.reduce((sum, row) => sum + row.weight, 0);
      let roll = random() * totalWeight;
      let selectedIndex = local.length - 1;

      for (let index = 0; index < local.length; index += 1) {
        roll -= local[index].weight;
        if (roll <= 0) {
          selectedIndex = index;
          break;
        }
      }

      const day = local[selectedIndex].day;
      out.push(day);
      used.add(day);
      local.splice(selectedIndex, 1);
    }
    return out;
  }

  const preseasonPool = allDays.filter((row) => row.day <= preseasonWindowEnd);
  const finalPool = allDays.filter((row) => row.day >= finalWindowStart);
  const regularPool = allDays.filter((row) => row.day > preseasonWindowEnd && row.day < finalWindowStart);

  selected.push(...weightedTake(preseasonPool, preseasonReserve));
  selected.push(...weightedTake(finalPool, deadlineReserve));
  selected.push(...weightedTake(regularPool, desired - selected.length));

  if (selected.length < desired) {
    selected.push(...weightedTake(allDays, desired - selected.length));
  }

  return [...new Set(selected)].sort((a, b) => a - b).slice(0, desired);
}

function createBankState(leagueData, context, testConfig = {}) {
  const seasonYear = getSeasonYear(leagueData, context);
  const seed = randomSeedToken(seasonYear, testConfig?.seed || "");
  const random = seededRandom(`${seed}|target`);
  const targetRoll = random();
  const targetBandRoll = random();
  let baseTargetTrades;
  if (targetRoll < 0.16) {
    baseTargetTrades = 22 + Math.floor(targetBandRoll * 2);
  } else if (targetRoll < 0.84) {
    baseTargetTrades = 24 + Math.floor(targetBandRoll * 5);
  } else {
    baseTargetTrades = 29 + Math.floor(targetBandRoll * 2);
  }
  const targetOverride = finiteNumber(testConfig?.targetTrades, 0);
  const targetTrades = targetOverride > 0
    ? clamp(Math.trunc(targetOverride), TARGET_MIN, TARGET_MAX)
    : baseTargetTrades;
  const minimumTrades = getContinuousMarketMinimumTrades(targetTrades);
  const {
    maximumGenerationPasses,
    maximumExactEvaluations,
  } = getContinuousMarketBudgets(targetTrades);
  const deadlineDay = Math.max(
    FIRST_EXECUTION_DAY + 1,
    Math.trunc(
      finiteNumber(
        context?.deadlineDayIndex,
        finiteNumber(context?.dayIndex, 0) + finiteNumber(context?.daysToDeadline, 120)
      )
    )
  );

  const completedTrades = countCpuTradesForSeason(leagueData, seasonYear);
  const executionPlanDays = buildExecutionPlan({
    seed,
    targetTrades,
    firstDay: FIRST_EXECUTION_DAY,
    deadlineDay,
  });
  const currentDayIndex = Math.max(0, Math.trunc(finiteNumber(context?.dayIndex, 0)));
  const elapsedPlanSlots = executionPlanDays.filter((day) => day < currentDayIndex).length;

  return {
    version: CPU_TRADE_BANK_VERSION,
    seasonYear,
    seed,
    testSeed: testConfig?.seed ? String(testConfig.seed) : "",
    leagueTeamFingerprint: leagueTeamFingerprint(leagueData),
    baseTargetTrades,
    targetTrades,
    minimumTrades,
    maximumGenerationPasses,
    maximumExactEvaluations,
    completedTrades,
    candidates: [],
    generationNonce: 0,
    lastGenerationDayIndex: null,
    selectionNonce: 0,
    pruneCursor: 0,
    planCursor: Math.min(
      executionPlanDays.length,
      Math.max(completedTrades, elapsedPlanSlots)
    ),
    executionPlanDays,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: makeStats(),
  };
}

function normalizeBankState(existing, leagueData, context, testConfig = {}) {
  const seasonYear = getSeasonYear(leagueData, context);
  const fingerprint = leagueTeamFingerprint(leagueData);
  const requestedTestSeed = testConfig?.seed ? String(testConfig.seed) : "";
  const shouldReset =
    !existing ||
    typeof existing !== "object" ||
    Number(existing.version) !== CPU_TRADE_BANK_VERSION ||
    Number(existing.seasonYear) !== seasonYear ||
    String(existing?.testSeed || "") !== requestedTestSeed ||
    (existing.leagueTeamFingerprint && existing.leagueTeamFingerprint !== fingerprint);

  if (shouldReset) {
    return {
      state: createBankState(leagueData, context, testConfig),
      changed: true,
      resetReason: !existing
        ? "missing"
        : Number(existing.seasonYear) !== seasonYear
          ? "new_season"
          : String(existing?.testSeed || "") !== requestedTestSeed
            ? "test_seed_changed"
            : "schema_or_league_changed",
    };
  }

  const completedTrades = countCpuTradesForSeason(leagueData, seasonYear);
  const normalizationChanged =
    !Array.isArray(existing.candidates) ||
    !existing.stats ||
    typeof existing.stats !== "object" ||
    !Number.isFinite(Number(existing.baseTargetTrades)) ||
    existing.leagueTeamFingerprint !== fingerprint ||
    Number(existing.completedTrades) !== completedTrades;
  const state = {
    ...existing,
    candidates: Array.isArray(existing.candidates) ? [...existing.candidates] : [],
    stats: makeStats(existing.stats),
    leagueTeamFingerprint: fingerprint,
    completedTrades,
  };

  const random = seededRandom(`${state.seed}|target`);
  const targetRoll = random();
  const targetBandRoll = random();
  let generatedBaseTarget;
  if (targetRoll < 0.16) {
    generatedBaseTarget = 22 + Math.floor(targetBandRoll * 2);
  } else if (targetRoll < 0.84) {
    generatedBaseTarget = 24 + Math.floor(targetBandRoll * 5);
  } else {
    generatedBaseTarget = 29 + Math.floor(targetBandRoll * 2);
  }
  const baseTargetTrades = clamp(
    Math.trunc(finiteNumber(state.baseTargetTrades, generatedBaseTarget)),
    TARGET_MIN,
    TARGET_MAX
  );
  state.baseTargetTrades = baseTargetTrades;
  const targetOverride = finiteNumber(testConfig?.targetTrades, 0);
  const desiredTargetTrades = targetOverride > 0
    ? clamp(Math.trunc(targetOverride), TARGET_MIN, TARGET_MAX)
    : baseTargetTrades;
  if (state.targetTrades !== desiredTargetTrades) {
    state.targetTrades = desiredTargetTrades;
    state.minimumTrades = getContinuousMarketMinimumTrades(state.targetTrades);
    ({
      maximumGenerationPasses: state.maximumGenerationPasses,
      maximumExactEvaluations: state.maximumExactEvaluations,
    } = getContinuousMarketBudgets(state.targetTrades));
    state.lastGenerationDayIndex = null;
    state.executionPlanDays = buildExecutionPlan({
      seed: state.seed,
      targetTrades: state.targetTrades,
      firstDay: FIRST_EXECUTION_DAY,
      deadlineDay: Math.max(
        FIRST_EXECUTION_DAY + 1,
        finiteNumber(context?.deadlineDayIndex, finiteNumber(context?.dayIndex, 0) + finiteNumber(context?.daysToDeadline, 120))
      ),
    });
    state.planCursor = Math.min(state.planCursor || 0, state.executionPlanDays.length);
    return {
      state,
      changed: true,
      resetReason: targetOverride > 0 ? "test_target_override" : "test_target_cleared",
    };
  }

  const boundedMinimumTrades = getContinuousMarketMinimumTrades(state.targetTrades);
  const continuousBudgets = getContinuousMarketBudgets(state.targetTrades);
  const boundedMaximumGenerationPasses = continuousBudgets.maximumGenerationPasses;
  const boundedMaximumExactEvaluations = continuousBudgets.maximumExactEvaluations;
  if (
    state.minimumTrades !== boundedMinimumTrades ||
    state.maximumGenerationPasses !== boundedMaximumGenerationPasses ||
    state.maximumExactEvaluations !== boundedMaximumExactEvaluations ||
    !(state.lastGenerationDayIndex === null || Number.isFinite(Number(state.lastGenerationDayIndex)))
  ) {
    state.minimumTrades = boundedMinimumTrades;
    state.maximumGenerationPasses = boundedMaximumGenerationPasses;
    state.maximumExactEvaluations = boundedMaximumExactEvaluations;
    state.lastGenerationDayIndex = Number.isFinite(Number(state.lastGenerationDayIndex))
      ? Math.trunc(Number(state.lastGenerationDayIndex))
      : null;
    state.updatedAt = new Date().toISOString();
    return { state, changed: true, resetReason: "bounded_market_state_normalized" };
  }

  if (!Array.isArray(state.executionPlanDays) || !state.executionPlanDays.length) {
    state.executionPlanDays = buildExecutionPlan({
      seed: state.seed,
      targetTrades: state.targetTrades,
      firstDay: FIRST_EXECUTION_DAY,
      deadlineDay: Math.max(
        FIRST_EXECUTION_DAY + 1,
        finiteNumber(context?.deadlineDayIndex, finiteNumber(context?.dayIndex, 0) + finiteNumber(context?.daysToDeadline, 120))
      ),
    });
    return { state, changed: true, resetReason: "missing_execution_plan" };
  }

  if (normalizationChanged) {
    state.updatedAt = new Date().toISOString();
    return { state, changed: true, resetReason: "state_normalized" };
  }

  return { state: existing, changed: false, resetReason: null };
}

export function ensureCpuTradeBankState(leagueData, context = {}, testConfig = {}) {
  if (!leagueData || typeof leagueData !== "object") {
    return { leagueData, state: null, changed: false, resetReason: "missing_league" };
  }

  const normalized = normalizeBankState(leagueData[CPU_TRADE_BANK_FIELD], leagueData, context, testConfig);
  if (!normalized.changed && leagueData[CPU_TRADE_BANK_FIELD] === normalized.state) {
    return { leagueData, ...normalized };
  }

  return {
    leagueData: {
      ...leagueData,
      [CPU_TRADE_BANK_FIELD]: normalized.state,
    },
    ...normalized,
  };
}

function compactPlayerReference(player = {}) {
  return {
    id: player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null,
    name: player?.name || player?.player || player?.playerName || "",
  };
}

function compactPickReference(pick = {}) {
  return {
    id: pick?.id || pick?.pickId || null,
    pickId: pick?.pickId || pick?.id || null,
    assetType: pick?.assetType || pick?.type || "pick",
    type: pick?.assetType || pick?.type || "pick",
    year: finiteNumber(pick?.year ?? pick?.seasonYear, 0),
    seasonYear: finiteNumber(pick?.seasonYear ?? pick?.year, 0),
    round: finiteNumber(pick?.round, 1),
    originalTeam: pick?.originalTeam || pick?.originalTeamName || pick?.team || "",
    originalTeamName: pick?.originalTeamName || pick?.originalTeam || pick?.team || "",
    ownerTeam: pick?.ownerTeam || pick?.currentOwnerTeamName || pick?.owner || "",
    currentOwnerTeamName: pick?.currentOwnerTeamName || pick?.ownerTeam || pick?.owner || "",
    protection: pick?.protection || pick?.protections || pick?.displayProtection || "Unprotected",
    protections: pick?.protections || pick?.protection || pick?.displayProtection || "Unprotected",
    displayProtection: pick?.displayProtection || pick?.protections || pick?.protection || "Unprotected",
    status: pick?.status || "active",
    pickNumber: pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || null,
    overallPick: pick?.overallPick || pick?.pickNumber || pick?.resolvedPickNumber || null,
  };
}

function compactItem(item = {}, teamName = "") {
  if (item?.type === "player") {
    return {
      type: "player",
      teamName,
      player: compactPlayerReference(item.player || {}),
    };
  }

  if (item?.type === "pick") {
    return {
      type: "pick",
      teamName,
      pick: compactPickReference(item.pick || {}),
      protection: item.protection || item.pick?.displayProtection || item.pick?.protection || "Unprotected",
      displayLabel: item.displayLabel || item.pick?.displayLabel || "",
      tradeRule: item.tradeRule || null,
      tradeValueExcluded: Boolean(item.tradeValueExcluded),
      displayOnlyLinkedSwap: Boolean(item.displayOnlyLinkedSwap),
    };
  }

  return null;
}

function itemSignature(item = {}) {
  if (item?.type === "player") {
    const player = item.player || {};
    return `p:${String(player.id ?? normalizeTeamName(player.name || ""))}`;
  }

  if (item?.type === "pick") {
    const pick = item.pick || {};
    return `d:${pick.id || `${pick.year}:${pick.round}:${normalizeTeamName(pick.originalTeam)}:${normalizeTeamName(pick.ownerTeam)}`}:${item.protection || ""}`;
  }

  return "unknown";
}

function sideSignature(teamName, items = []) {
  return `${normalizeTeamName(teamName)}[${items.map(itemSignature).sort().join(",")}]`;
}

export function getCpuTradeCandidateSignature(candidate = {}) {
  const fromTeamName = candidate?.fromTeamName || candidate?.sellerTeamName || candidate?.teamA || "";
  const toTeamName = candidate?.toTeamName || candidate?.buyerTeamName || candidate?.teamB || "";
  const fromItems = Array.isArray(candidate?.fromItems) ? candidate.fromItems : [];
  const toItems = Array.isArray(candidate?.toItems) ? candidate.toItems : [];
  const sides = [
    sideSignature(fromTeamName, fromItems),
    sideSignature(toTeamName, toItems),
  ].sort();
  return sides.join("::");
}

function compactCandidateForBank(candidate, validation, context, state) {
  const fromTeamName = validation?.candidate?.fromTeamName || candidate?.fromTeamName || "";
  const toTeamName = validation?.candidate?.toTeamName || candidate?.toTeamName || "";
  const fromItems = (validation?.candidate?.fromItems || candidate?.fromItems || [])
    .map((item) => compactItem(item, fromTeamName))
    .filter(Boolean);
  const toItems = (validation?.candidate?.toItems || candidate?.toItems || [])
    .map((item) => compactItem(item, toTeamName))
    .filter(Boolean);
  const signature = getCpuTradeCandidateSignature({
    fromTeamName,
    toTeamName,
    fromItems,
    toItems,
  });
  const bankId = `cpu_bank_${hashString(`${state.seed}|${signature}`).toString(16)}`;

  return {
    id: bankId,
    bankId,
    signature,
    fromTeamName,
    toTeamName,
    fromItems,
    toItems,
    motive: candidate?.motive || "",
    debug: candidate?.debug || {},
    priority: finiteNumber(validation?.evaluation?.score, 0),
    bankMeta: {
      generatedDate: context?.generatedDate || context?.currentDate || "",
      generatedDayIndex: finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0),
      generationNonce: finiteNumber(state.generationNonce, 0),
      acceptedAtGeneration: true,
      fromTeamScore: finiteNumber(validation?.fromTeamView?.score, 0),
      toTeamScore: finiteNumber(validation?.toTeamView?.score, 0),
      lastValidatedDate: context?.currentDate || "",
      validationCount: 1,
    },
  };
}

function countBankEntriesForTeam(candidates = [], teamName = "") {
  return candidates.filter(
    (candidate) => sameTeam(candidate?.fromTeamName, teamName) || sameTeam(candidate?.toTeamName, teamName)
  ).length;
}

function candidateTradeQualityScore(candidate = {}, seed = "") {
  const targetOvr = finiteNumber(candidate?.debug?.targetOvr, 0);
  const targetTier = String(candidate?.debug?.targetTier || "").toLowerCase();
  const priority = finiteNumber(candidate?.priority, 0);
  const assetCount =
    (Array.isArray(candidate?.fromItems) ? candidate.fromItems.length : 0) +
    (Array.isArray(candidate?.toItems) ? candidate.toItems.length : 0);
  const firstCount = [...(candidate?.fromItems || []), ...(candidate?.toItems || [])].filter(
    (item) => item?.type === "pick" && finiteNumber(item?.pick?.round ?? item?.round, 2) === 1
  ).length;
  const tierBonus =
    targetOvr >= 88 || targetTier === "franchise"
      ? 9.0
      : targetOvr >= 85 || targetTier === "star"
        ? 7.0
        : targetOvr >= 80 || targetTier === "starter"
          ? 5.5
          : targetOvr >= 77
            ? 1.2
            : 0;
  const seededJitter = seed ? seededRandom(`${seed}|quality:${candidate?.bankId || candidate?.id || candidate?.signature || ""}`)() : 0;
  return priority + tierBonus + Math.min(1.6, assetCount * 0.18) + Math.min(1.4, firstCount * 0.7) + seededJitter * 1.05;
}

function rankCandidatesForExecution(candidates = [], state = {}, context = {}) {
  const seed = `${state?.seed || ""}|selection-quality:${state?.selectionNonce || 0}|${context?.currentDate || context?.dayIndex || ""}`;
  return [...candidates]
    .map((candidate) => ({
      candidate,
      score: candidateTradeQualityScore(candidate, seed),
    }))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.candidate);
}

function trimBank(candidates = []) {
  if (candidates.length <= MAX_BANK_SIZE) return candidates;
  return [...candidates]
    .sort((a, b) => {
      const aScore = candidateTradeQualityScore(a);
      const bScore = candidateTradeQualityScore(b);
      if (aScore !== bScore) return bScore - aScore;
      return finiteNumber(b?.bankMeta?.generatedDayIndex, 0) - finiteNumber(a?.bankMeta?.generatedDayIndex, 0);
    })
    .slice(0, MAX_BANK_SIZE);
}

function isBeforeDeadline(context = {}) {
  if (context?.inOffseason) return false;
  if (context?.currentDate && context?.tradeDeadlineDate) {
    return String(context.currentDate) < String(context.tradeDeadlineDate);
  }
  return finiteNumber(context?.daysToDeadline, 1) > 0;
}

function getCpuTradeMinimumTarget(state = {}) {
  return getContinuousMarketMinimumTrades(state?.targetTrades);
}

function countUpcomingExecutionSlots(state = {}, dayIndex = 0, horizonDays = 28) {
  const cursor = Math.max(0, Math.trunc(finiteNumber(state?.planCursor, 0)));
  const startDay = Math.max(0, Math.trunc(finiteNumber(dayIndex, 0)));
  const endDay = startDay + Math.max(1, Math.trunc(finiteNumber(horizonDays, 28)));
  return (Array.isArray(state?.executionPlanDays) ? state.executionPlanDays : [])
    .slice(cursor)
    .filter((plannedDay) => {
      const day = finiteNumber(plannedDay, -1);
      return day >= startDay && day <= endDay;
    }).length;
}

function getNextExecutionPlanDay(state = {}) {
  const cursor = Math.max(0, Math.trunc(finiteNumber(state?.planCursor, 0)));
  const plannedDay = state?.executionPlanDays?.[cursor];
  return Number.isFinite(Number(plannedDay)) ? Number(plannedDay) : null;
}

export function getCpuTradeBankRunwayStatus(state, context = {}) {
  const targetTrades = finiteNumber(state?.targetTrades, 27);
  const minimumTrades = getCpuTradeMinimumTarget(state);
  const completedTrades = finiteNumber(state?.completedTrades, 0);
  const remainingDesired = Math.max(0, targetTrades - completedTrades);
  const remainingMinimum = Math.max(0, minimumTrades - completedTrades);
  const bankSize = Array.isArray(state?.candidates) ? state.candidates.length : 0;
  const dayIndex = Math.max(0, Math.trunc(finiteNumber(context?.dayIndex, 0)));
  const daysToDeadline = finiteNumber(context?.daysToDeadline, 999);
  const deadlineDayIndex = Math.max(
    dayIndex + 1,
    Math.trunc(finiteNumber(context?.deadlineDayIndex, dayIndex + Math.max(1, daysToDeadline)))
  );
  const deadlineProgress = clamp(dayIndex / Math.max(1, deadlineDayIndex), 0, 1);
  const expectedMinimumByNow = Math.floor(minimumTrades * Math.pow(deadlineProgress, 1.72));
  const completionDeficit = Math.max(0, expectedMinimumByNow - completedTrades);
  const horizonDays = daysToDeadline <= 21 ? 18 : daysToDeadline <= 60 ? 24 : 30;
  const upcomingSlots = countUpcomingExecutionSlots(state, dayIndex, horizonDays);
  const minimumSecured = remainingMinimum <= 0;
  const lateOptionalInventoryLocked = minimumSecured && daysToDeadline <= 21;
  const desiredReserve = remainingDesired <= 0 || lateOptionalInventoryLocked || upcomingSlots <= 0
    ? 0
    : Math.min(
        remainingDesired,
        clamp(upcomingSlots + 1, 2, daysToDeadline <= 35 ? 6 : 5)
      );
  const reserveDeficit = Math.max(0, desiredReserve - bankSize);
  const nextPlannedDay = getNextExecutionPlanDay(state);
  const daysUntilNextSlot = nextPlannedDay === null ? 999 : nextPlannedDay - dayIndex;
  const dueSoon = daysUntilNextSlot <= 4;
  const critical = remainingMinimum > 0 && (
    bankSize === 0 ||
    completionDeficit >= 2 ||
    (dueSoon && reserveDeficit > 0)
  );
  const emergency = remainingMinimum > 0 && bankSize === 0 && daysToDeadline <= 14;
  const inventoryPressure = remainingDesired <= 0
    ? 0
    : clamp(
        reserveDeficit / Math.max(1, desiredReserve) +
          completionDeficit * 0.18 +
          (bankSize === 0 ? 0.35 : 0),
        0,
        2
      );

  return {
    targetTrades,
    minimumTrades,
    completedTrades,
    remainingTarget: remainingDesired,
    remainingDesired,
    remainingMinimum,
    minimumSecured,
    bankSize,
    daysToDeadline,
    deadlineProgress,
    expectedCompletedByNow: expectedMinimumByNow,
    expectedMinimumByNow,
    completionDeficit,
    horizonDays,
    upcomingSlots,
    desiredReserve,
    reserveFloor: desiredReserve,
    reserveDeficit,
    nextPlannedDay,
    daysUntilNextSlot,
    dueSoon,
    critical,
    emergency,
    lateOptionalInventoryLocked,
    inventoryPressure,
  };
}

function traceCpuTradeBankPolicy(result, state = {}, context = {}) {
  if (!isCpuTradeDeepTraceEnabled()) return result;
  recordCpuTradeTrace("bank", "generation_policy", {
    currentDate: context?.currentDate || "",
    dayIndex: finiteNumber(context?.dayIndex, 0),
    generationNonce: finiteNumber(state?.generationNonce, 0),
    bankSize: Array.isArray(state?.candidates) ? state.candidates.length : 0,
    completedTrades: finiteNumber(state?.completedTrades, 0),
    targetTrades: finiteNumber(state?.targetTrades, 0),
    shouldGenerate: Boolean(result?.shouldGenerate),
    reason: result?.reason || "",
    maxCandidates: finiteNumber(result?.maxCandidates, 0),
    exactEvaluations: finiteNumber(result?.exactEvaluations, 0),
    completionDeficit: finiteNumber(result?.completionDeficit ?? result?.runway?.completionDeficit, 0),
    reserveDeficit: finiteNumber(result?.reserveDeficit ?? result?.runway?.reserveDeficit, 0),
    inventoryPressure: finiteNumber(result?.inventoryPressure ?? result?.runway?.inventoryPressure, 0),
  });
  return result;
}

export function getCpuTradeBankGenerationPolicy(state, context = {}, testConfig = {}) {
  if (!state || !isBeforeDeadline(context)) {
    return traceCpuTradeBankPolicy({
      shouldGenerate: false,
      reason: "timing_locked",
      maxCandidates: 0,
      exactEvaluations: 0,
    }, state, context);
  }

  const dayIndex = Math.max(0, Math.trunc(finiteNumber(context?.dayIndex, 0)));
  const daysToDeadline = finiteNumber(context?.daysToDeadline, 999);
  const runway = getCpuTradeBankRunwayStatus(state, context);
  const generationPasses = finiteNumber(state?.stats?.generationPasses, 0);
  const exactEvaluations = finiteNumber(state?.stats?.exactEvaluations, 0);
  const maximumGenerationPasses = clamp(
    Math.trunc(finiteNumber(state?.maximumGenerationPasses, Math.ceil(runway.targetTrades * 0.72))),
    14,
    22
  );
  const maximumExactEvaluations = clamp(
    Math.trunc(finiteNumber(state?.maximumExactEvaluations, runway.targetTrades * 28)),
    616,
    840
  );
  const generationPassBudgetRemaining = Math.max(0, maximumGenerationPasses - generationPasses);
  const exactEvaluationBudgetRemaining = Math.max(0, maximumExactEvaluations - exactEvaluations);

  if (runway.remainingDesired <= 0) {
    return traceCpuTradeBankPolicy({
      shouldGenerate: false,
      reason: "desired_ceiling_complete",
      maxCandidates: 0,
      exactEvaluations: 0,
      runway,
      generationPassBudgetRemaining,
      exactEvaluationBudgetRemaining,
    }, state, context);
  }

  if (runway.lateOptionalInventoryLocked) {
    return traceCpuTradeBankPolicy({
      shouldGenerate: false,
      reason: "minimum_secured_late_market",
      maxCandidates: 0,
      exactEvaluations: 0,
      runway,
      generationPassBudgetRemaining,
      exactEvaluationBudgetRemaining,
    }, state, context);
  }

  if (generationPassBudgetRemaining <= 0 || exactEvaluationBudgetRemaining <= 0) {
    return traceCpuTradeBankPolicy({
      shouldGenerate: false,
      reason: generationPassBudgetRemaining <= 0
        ? "generation_pass_budget_exhausted"
        : "exact_validation_budget_exhausted",
      maxCandidates: 0,
      exactEvaluations: 0,
      runway,
      generationPassBudgetRemaining,
      exactEvaluationBudgetRemaining,
    }, state, context);
  }

  const decision = decideContinuousMarketGeneration({
    dayIndex,
    daysToDeadline,
    seed: state?.seed || "",
    generationNonce: state?.generationNonce || 0,
    lastGenerationDayIndex: state?.lastGenerationDayIndex,
    generationPasses,
    exactEvaluations,
    maximumGenerationPasses,
    maximumExactEvaluations,
    runway,
    forceGeneration: Boolean(testConfig?.forceGeneration),
  });

  return traceCpuTradeBankPolicy({
    shouldGenerate: decision.shouldGenerate,
    reason: decision.reason,
    cadence: decision.cooldownDays,
    cooldownDays: decision.cooldownDays,
    cooldownReady: decision.cooldownReady,
    lastGenerationDayIndex: decision.lastGenerationDayIndex,
    minimumFloorRecovery: decision.minimumFloorRecovery,
    desiredReserve: runway.desiredReserve,
    completionDeficit: runway.completionDeficit,
    reserveDeficit: runway.reserveDeficit,
    supplyUrgent: runway.critical,
    supplySatisfied: runway.reserveDeficit <= 0,
    inventoryPressure: runway.inventoryPressure,
    runway,
    generationPasses,
    maximumGenerationPasses,
    generationPassBudgetRemaining,
    exactEvaluations,
    maximumExactEvaluations,
    exactEvaluationBudgetRemaining,
    foregroundRecommended: false,
    foregroundPasses: 0,
    maxCandidates: decision.shouldGenerate
      ? clamp(
          Math.trunc(finiteNumber(testConfig?.generationCandidates, decision.requestedCandidates)),
          1,
          Math.min(MAX_GENERATION_CANDIDATES_PER_PASS, decision.requestedCandidates)
        )
      : 0,
    exactEvaluations: decision.shouldGenerate
      ? clamp(
          Math.trunc(finiteNumber(testConfig?.exactEvaluations, decision.exactEvaluationLimit)),
          1,
          Math.min(MAX_EXACT_EVALUATIONS_PER_PASS, decision.exactEvaluationLimit)
        )
      : 0,
  }, state, context);
}

export function buildCpuTradeWorkerContext(state, context = {}, policy = {}) {
  return {
    currentDate: context?.currentDate || "",
    dayIndex: finiteNumber(context?.dayIndex, 0),
    totalDates: finiteNumber(context?.totalDates, 170),
    tradeDeadlineDate: context?.tradeDeadlineDate || "",
    daysToDeadline: finiteNumber(context?.daysToDeadline, 999),
    userTeamName: getContextUserTeamName(context),
    recordsByTeam: context?.recordsByTeam || {},
    maxCandidates: policy?.maxCandidates || 4,
    bankGenerationMode: true,
    bankSeed: state?.seed || "",
    generationNonce: finiteNumber(state?.generationNonce, 0),
    forceCpuTradeActivity: true,
    remainingTarget: Math.max(0, finiteNumber(state?.targetTrades, 30) - finiteNumber(state?.completedTrades, 0)),
    bankSize: Array.isArray(state?.candidates) ? state.candidates.length : 0,
    inventoryPressure: finiteNumber(policy?.inventoryPressure ?? policy?.runway?.inventoryPressure, 0),
    foregroundRecommended: Boolean(policy?.foregroundRecommended),
  };
}

export async function addGeneratedCpuTradeCandidates({
  leagueData,
  response,
  context = {},
  testConfig = {},
  exactEvaluationLimit = 3,
} = {}) {
  const startedAt = Date.now();
  const ensured = ensureCpuTradeBankState(leagueData, context, testConfig);
  if (!ensured.state) {
    return { leagueData, state: null, changed: false, accepted: [], rejected: [] };
  }

  const state = {
    ...ensured.state,
    candidates: [...ensured.state.candidates],
    stats: makeStats(ensured.state.stats),
  };
  const candidates = shuffled(
    Array.isArray(response?.candidates) ? response.candidates : [],
    `${state.seed}|generation:${state.generationNonce}`
  );
  const accepted = [];
  const rejected = [];
  const existingSignatures = new Set(state.candidates.map((candidate) => candidate.signature));
  const userTeamName = getContextUserTeamName(context, ensured.leagueData);
  const limit = clamp(Math.trunc(finiteNumber(exactEvaluationLimit, 3)), 1, MAX_EXACT_EVALUATIONS_PER_PASS);
  const validationCacheScope = buildSameStateValidationCacheScope(
    ensured.leagueData,
    context,
    state
  );
  prepareSameStateValidationCache(validationCacheScope);
  const bankSizeBeforeAdmission = state.candidates.length;
  const traceEnabled = isCpuTradeDeepTraceEnabled();
  if (traceEnabled) {
    recordCpuTradeTrace("bank", "admission_started", {
      currentDate: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      generationNonce: finiteNumber(state?.generationNonce, 0),
      proposedCandidates: candidates.length,
      exactEvaluationLimit: limit,
      bankSizeBefore: bankSizeBeforeAdmission,
      workerDebug: response?.debug || null,
    });
  }

  const exactEvaluationsBefore = state.stats.exactEvaluations;
  const duplicatesBefore = state.stats.duplicateCandidates;
  const rejectionsBefore = state.stats.rejectedCandidates;
  state.stats.generationPasses += 1;
  state.stats.proposedCandidates += candidates.length;

  const admissionCandidates = candidates.slice(0, limit);
  const parallelPlan = [];
  let parallelResultsByIndex = null;
  let parallelFallbackReason = "";

  for (let candidateIndex = 0; candidateIndex < admissionCandidates.length; candidateIndex += 1) {
    const candidate = admissionCandidates[candidateIndex];
    const fromTeamName = candidate?.fromTeamName || candidate?.sellerTeamName || candidate?.teamA || "";
    const toTeamName = candidate?.toTeamName || candidate?.buyerTeamName || candidate?.teamB || "";
    const signature = getCpuTradeCandidateSignature(candidate);

    if (
      !fromTeamName ||
      !toTeamName ||
      sameTeam(fromTeamName, userTeamName) ||
      sameTeam(toTeamName, userTeamName) ||
      existingSignatures.has(signature) ||
      sameStateValidationCache.has(signature) ||
      countBankEntriesForTeam(state.candidates, fromTeamName) >= MAX_BANK_ENTRIES_PER_TEAM ||
      countBankEntriesForTeam(state.candidates, toTeamName) >= MAX_BANK_ENTRIES_PER_TEAM
    ) {
      continue;
    }

    parallelPlan.push({ candidateIndex, candidate });
  }

  if (parallelPlan.length >= 2) {
    try {
      const parallelRows = await validateCpuTradeCandidatesParallel({
        leagueData: ensured.leagueData,
        candidates: parallelPlan.map((row) => row.candidate),
        currentDate: context?.currentDate || "",
        tradeDeadlineDate: context?.tradeDeadlineDate || "",
        inOffseason: Boolean(context?.inOffseason),
        recordsByTeam: context?.recordsByTeam,
      });

      parallelResultsByIndex = new Map(
        parallelPlan.map((row, index) => [row.candidateIndex, parallelRows[index]])
      );
      state.stats.exactEvaluations += parallelPlan.length;
      if (context?.recordsByTeam && typeof context.recordsByTeam === "object") {
        state.stats.recordSnapshotValidationCalls += parallelPlan.length;
      }
    } catch (error) {
      parallelFallbackReason = error?.message || String(error || "parallel_validation_failed");
      recordCpuTradeTiming("parallelValidationFallbackMs", 0, {
        phase: "admission",
        reason: parallelFallbackReason,
        candidateCount: parallelPlan.length,
      });
      parallelResultsByIndex = null;
    }
  }

  for (let candidateIndex = 0; candidateIndex < admissionCandidates.length; candidateIndex += 1) {
    const candidate = admissionCandidates[candidateIndex];
    const fromTeamName = candidate?.fromTeamName || candidate?.sellerTeamName || candidate?.teamA || "";
    const toTeamName = candidate?.toTeamName || candidate?.buyerTeamName || candidate?.teamB || "";

    if (
      !fromTeamName ||
      !toTeamName ||
      sameTeam(fromTeamName, userTeamName) ||
      sameTeam(toTeamName, userTeamName)
    ) {
      state.stats.rejectedCandidates += 1;
      bumpReason(state.stats, "user_or_missing_team");
      rejected.push({ candidate, reason: "Candidate included the user team or a missing team." });
      continue;
    }

    const signature = getCpuTradeCandidateSignature(candidate);
    if (existingSignatures.has(signature)) {
      state.stats.duplicateCandidates += 1;
      bumpReason(state.stats, "duplicate");
      continue;
    }

    if (
      countBankEntriesForTeam(state.candidates, fromTeamName) >= MAX_BANK_ENTRIES_PER_TEAM ||
      countBankEntriesForTeam(state.candidates, toTeamName) >= MAX_BANK_ENTRIES_PER_TEAM
    ) {
      state.stats.rejectedCandidates += 1;
      bumpReason(state.stats, "team_bank_limit");
      rejected.push({ candidate, reason: "Team already has enough alternatives in the bank." });
      continue;
    }

    const cacheLookupStartedAt = cpuTradeNow();
    let validation = sameStateValidationCache.get(signature) || null;
    const validationCacheHit = Boolean(validation);
    recordCpuTradeTiming("sameStateValidationCacheLookupMs", cpuTradeNow() - cacheLookupStartedAt, {
      phase: "admission",
      hit: validationCacheHit,
    });

    if (validationCacheHit) {
      state.stats.sameStateValidationCacheHits += 1;
      state.stats.sameStateAdmissionCacheHits += 1;
      if (validation?.ok === false) state.stats.cachedAdmissionRejections += 1;
    } else {
      const parallelRow = parallelResultsByIndex?.get(candidateIndex) || null;

      if (parallelRow?.result) {
        validation = parallelRow.result;
        recordCpuTradeValidation({
          phase: "admission_parallel",
          signature,
          candidate,
          leagueData: ensured.leagueData,
          context,
          result: validation,
          durationMs: finiteNumber(parallelRow.durationMs, 0),
        });
      } else {
        state.stats.exactEvaluations += 1;
        if (context?.recordsByTeam && typeof context.recordsByTeam === "object") {
          state.stats.recordSnapshotValidationCalls += 1;
        }
        const validationStartedAt = cpuTradeNow();
        validation = validateCpuTradeCandidateOnLeague({
          leagueData: ensured.leagueData,
          candidate,
          currentDate: context?.currentDate || "",
          tradeDeadlineDate: context?.tradeDeadlineDate || "",
          inOffseason: Boolean(context?.inOffseason),
          recordsByTeam: context?.recordsByTeam || null,
        });
        const validationMs = cpuTradeNow() - validationStartedAt;
        recordCpuTradeTiming("exactValidationMs", validationMs, {
          phase: parallelFallbackReason ? "admission_serial_fallback" : "admission",
          fallbackReason: parallelFallbackReason || null,
        });
        recordCpuTradeValidation({
          phase: parallelFallbackReason ? "admission_serial_fallback" : "admission",
          signature,
          candidate,
          leagueData: ensured.leagueData,
          context,
          result: validation,
          durationMs: validationMs,
        });
      }

      rememberSameStateValidation(signature, validation);
    }

    if (!validation.ok) {
      state.stats.rejectedCandidates += 1;
      bumpReason(state.stats, validation?.staleCode || "bilateral_rejection");
      rejected.push({ candidate, validation, reason: validation?.reason || "Candidate rejected." });
      continue;
    }

    const bankCandidate = compactCandidateForBank(candidate, validation, context, state);
    state.candidates.push(bankCandidate);
    existingSignatures.add(bankCandidate.signature);
    state.stats.acceptedIntoBank += 1;
    accepted.push(bankCandidate);

    // Stop exact validation once this pass has rebuilt a healthy inventory
    // runway. This preserves validation/execution logic for every accepted
    // trade while avoiding v5's expensive surplus bank construction.
    const runwayAfterAccept = getCpuTradeBankRunwayStatus(state, context);
    const surplusBuffer = runwayAfterAccept.daysToDeadline <= 21 ? 8 : 5;
    const enoughInventory =
      runwayAfterAccept.remainingTarget > 0 &&
      state.candidates.length >= Math.min(
        MAX_BANK_SIZE,
        runwayAfterAccept.desiredReserve + surplusBuffer
      );
    if (enoughInventory && accepted.length >= 2 && !runwayAfterAccept.emergency) {
      break;
    }
  }

  state.candidates = trimBank(state.candidates);
  state.generationNonce += 1;
  state.lastGenerationDayIndex = Math.max(
    0,
    Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0))
  );
  state.updatedAt = new Date().toISOString();
  const generationConsumeMs = Date.now() - startedAt;
  state.stats.processingMs += generationConsumeMs;
  recordCpuTradeTiming("generationConsumeMs", generationConsumeMs, {
    proposed: candidates.length,
    accepted: accepted.length,
    rejected: rejected.length,
  });
  if (traceEnabled) {
    recordCpuTradeTrace("bank", "admission_completed", {
      currentDate: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      consumedGenerationNonce: finiteNumber(state?.generationNonce, 1) - 1,
      proposedCandidates: candidates.length,
      processedCandidates: Math.min(candidates.length, limit),
      acceptedCount: accepted.length,
      rejectedCount: state.stats.rejectedCandidates - rejectionsBefore,
      duplicateCount: state.stats.duplicateCandidates - duplicatesBefore,
      exactEvaluationCount: state.stats.exactEvaluations - exactEvaluationsBefore,
      bankSizeBefore: bankSizeBeforeAdmission,
      bankSizeAfter: state.candidates.length,
      admissionMs: generationConsumeMs,
      parallelFallbackReason: parallelFallbackReason || null,
    });
  }
  state.stats.lastGeneration = {
    date: context?.currentDate || "",
    dayIndex: finiteNumber(context?.dayIndex, 0),
    proposed: candidates.length,
    processed: Math.min(candidates.length, limit),
    exactEvaluations: state.stats.exactEvaluations - exactEvaluationsBefore,
    accepted: accepted.length,
    rejected: state.stats.rejectedCandidates - rejectionsBefore,
    duplicates: state.stats.duplicateCandidates - duplicatesBefore,
    bankSize: state.candidates.length,
    workerSkippedReason: response?.skippedReason || null,
    workerDebug: response?.debug || null,
  };

  return {
    leagueData: {
      ...ensured.leagueData,
      [CPU_TRADE_BANK_FIELD]: state,
    },
    state,
    // Consuming a completed generation pass always advances the nonce and telemetry,
    // even when the worker found no viable candidates. Persist that progress so a
    // save/reload does not repeat the same diagnostic pass indefinitely.
    changed: true,
    accepted,
    rejected,
  };
}

function executionDue(state, context = {}, testConfig = {}) {
  if (!state || !isBeforeDeadline(context)) return false;
  if (finiteNumber(state.completedTrades, 0) >= finiteNumber(state.targetTrades, 30)) return false;
  if (testConfig?.forceExecution) return true;

  const dayIndex = finiteNumber(context?.dayIndex, 0);
  const cursor = Math.max(0, Math.trunc(finiteNumber(state.planCursor, 0)));
  const plannedDay = state.executionPlanDays?.[cursor];
  const daysToDeadline = finiteNumber(context?.daysToDeadline, 999);
  const deadlineDayIndex = Math.max(
    dayIndex + 1,
    Math.trunc(finiteNumber(context?.deadlineDayIndex, dayIndex + Math.max(1, daysToDeadline)))
  );
  const deadlineProgress = clamp(dayIndex / Math.max(1, deadlineDayIndex), 0, 1);
  const minimumTrades = getCpuTradeMinimumTarget(state);
  const expectedCompletedByNow = Math.floor(minimumTrades * Math.pow(deadlineProgress, 1.72));
  const behindPace = finiteNumber(state.completedTrades, 0) < expectedCompletedByNow;
  const bankHasInventory = Array.isArray(state.candidates) && state.candidates.length > 0;
  const completedTrades = finiteNumber(state.completedTrades, 0);
  const targetTrades = finiteNumber(state.targetTrades, 30);
  const preseasonTarget = Math.min(5, Math.max(3, Math.ceil(targetTrades * 0.18)));

  if (context?.preseasonTradeWindow && bankHasInventory && completedTrades < preseasonTarget) {
    return true;
  }
  if (behindPace && bankHasInventory && daysToDeadline <= 70) return true;
  if (!Number.isFinite(Number(plannedDay))) return false;
  return dayIndex >= Number(plannedDay);
}

function removeCandidatesInvolvingTeams(candidates = [], teamNames = []) {
  return candidates.filter((candidate) =>
    !teamNames.some(
      (teamName) =>
        sameTeam(candidate?.fromTeamName, teamName) ||
        sameTeam(candidate?.toTeamName, teamName)
    )
  );
}

export function executeDueCpuTradeFromBank({
  leagueData,
  context = {},
  testConfig = {},
  maxCandidateChecks = 4,
} = {}) {
  const startedAt = Date.now();
  const ensured = ensureCpuTradeBankState(leagueData, context, testConfig);
  if (!ensured.state) {
    return { leagueData, state: null, changed: false, executed: false, tradeRecord: null };
  }

  const state = {
    ...ensured.state,
    candidates: [...ensured.state.candidates],
    stats: makeStats(ensured.state.stats),
  };

  const executionTraceEnabled = isCpuTradeDeepTraceEnabled();
  if (executionTraceEnabled) {
    recordCpuTradeTrace("bank", "execution_check_started", {
      currentDate: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      selectionNonce: finiteNumber(state?.selectionNonce, 0),
      bankSizeBefore: state.candidates.length,
      completedTrades: finiteNumber(state?.completedTrades, 0),
      targetTrades: finiteNumber(state?.targetTrades, 0),
    });
  }

  const userTeamName = getContextUserTeamName(context, ensured.leagueData);
  const candidatesBeforeUserLock = state.candidates.length;

  if (userTeamName) {
    state.candidates = state.candidates.filter(
      (candidate) => !candidateInvolvesTeam(candidate, userTeamName)
    );
  }

  const userLockedCandidatesRemoved =
    candidatesBeforeUserLock - state.candidates.length;

  if (userLockedCandidatesRemoved > 0) {
    state.stats.staleCandidatesRemoved += userLockedCandidatesRemoved;
    for (let index = 0; index < userLockedCandidatesRemoved; index += 1) {
      bumpReason(state.stats, "user_team_locked");
    }
    state.updatedAt = new Date().toISOString();
  }

  if (!executionDue(state, context, testConfig)) {
    return {
      leagueData:
        userLockedCandidatesRemoved > 0
          ? {
              ...ensured.leagueData,
              [CPU_TRADE_BANK_FIELD]: state,
            }
          : ensured.leagueData,
      state,
      changed: ensured.changed || userLockedCandidatesRemoved > 0,
      executed: false,
      tradeRecord: null,
      reason: "not_due",
    };
  }

  state.stats.executionAttempts += 1;
  const candidates = rankCandidatesForExecution(
    state.candidates,
    state,
    context
  );
  const checkLimit = clamp(Math.trunc(finiteNumber(maxCandidateChecks, 4)), 1, 36);

  if (!candidates.length) {
    state.stats.executionDeferrals += 1;
    state.selectionNonce += 1;
    state.updatedAt = new Date().toISOString();
    state.stats.lastExecution = {
      date: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      result: "deferred_empty_bank",
      bankSize: 0,
    };
    state.stats.processingMs += Date.now() - startedAt;
    return {
      leagueData: {
        ...ensured.leagueData,
        [CPU_TRADE_BANK_FIELD]: state,
      },
      state,
      changed: true,
      executed: false,
      tradeRecord: null,
      reason: "empty_bank",
    };
  }

  const staleIds = new Set();
  let lastFailure = null;

  for (const candidate of candidates.slice(0, checkLimit)) {
    if (candidateInvolvesTeam(candidate, userTeamName)) {
      staleIds.add(candidate.bankId || candidate.id);
      state.stats.staleCandidatesRemoved += 1;
      bumpReason(state.stats, "user_team_locked");
      lastFailure = {
        ok: false,
        staleCode: "user_team_locked",
        reason: `CPU trade candidate involved controlled team ${userTeamName}.`,
      };
      continue;
    }

    if (testConfig?.dryRun) {
      if (context?.recordsByTeam && typeof context.recordsByTeam === "object") {
        state.stats.recordSnapshotValidationCalls += 1;
      }
      const validationStartedAt = cpuTradeNow();
      const validation = validateCpuTradeCandidateOnLeague({
        leagueData: ensured.leagueData,
        candidate,
        currentDate: context?.currentDate || "",
        tradeDeadlineDate: context?.tradeDeadlineDate || "",
        inOffseason: Boolean(context?.inOffseason),
        recordsByTeam: context?.recordsByTeam || null,
      });
      const validationMs = cpuTradeNow() - validationStartedAt;
      recordCpuTradeTiming("exactValidationMs", validationMs, { phase: "dry_run" });
      recordCpuTradeValidation({
        phase: "dry_run",
        signature: candidate?.signature || getCpuTradeCandidateSignature(candidate),
        candidate,
        leagueData: ensured.leagueData,
        context,
        result: validation,
        durationMs: validationMs,
      });

      state.stats.dryRuns += 1;
      if (!validation.ok) {
        staleIds.add(candidate.bankId || candidate.id);
        state.stats.staleCandidatesRemoved += 1;
        bumpReason(state.stats, validation?.staleCode || "dry_run_rejected");
        lastFailure = validation;
        continue;
      }

      state.selectionNonce += 1;
      state.stats.lastExecution = {
        date: context?.currentDate || "",
        dayIndex: finiteNumber(context?.dayIndex, 0),
        result: "dry_run_valid",
        candidateId: candidate.bankId || candidate.id,
        teams: [candidate.fromTeamName, candidate.toTeamName],
      };
      state.stats.processingMs += Date.now() - startedAt;
      state.candidates = state.candidates.filter((row) => !staleIds.has(row.bankId || row.id));
      return {
        leagueData: {
          ...ensured.leagueData,
          [CPU_TRADE_BANK_FIELD]: state,
        },
        state,
        changed: true,
        executed: false,
        dryRun: true,
        dryRunCandidate: validation.candidate,
        validation,
        reason: "dry_run_valid",
      };
    }

    if (context?.recordsByTeam && typeof context.recordsByTeam === "object") {
      state.stats.recordSnapshotValidationCalls += 1;
    }
    const executionStartedAt = cpuTradeNow();
    const result = executeCpuTradeCandidateOnLeague({
      leagueData: ensured.leagueData,
      candidate,
      currentDate: context?.currentDate || "",
      tradeDeadlineDate: context?.tradeDeadlineDate || "",
      inOffseason: Boolean(context?.inOffseason),
      recordsByTeam: context?.recordsByTeam || null,
    });
    const executionMs = cpuTradeNow() - executionStartedAt;
    recordCpuTradeTiming("executionMs", executionMs, {
      ok: Boolean(result?.ok),
      phase: "execution",
    });
    recordCpuTradeValidation({
      phase: "execution",
      signature: candidate?.signature || getCpuTradeCandidateSignature(candidate),
      candidate,
      leagueData: ensured.leagueData,
      context,
      result,
      durationMs: executionMs,
    });

    if (!result?.ok || !result?.leagueData) {
      staleIds.add(candidate.bankId || candidate.id);
      state.stats.staleCandidatesRemoved += 1;
      bumpReason(state.stats, result?.staleCode || "execution_revalidation_failed");
      lastFailure = result;
      continue;
    }

    state.completedTrades = countCpuTradesForSeason(result.leagueData, state.seasonYear);
    state.planCursor = Math.min(
      state.executionPlanDays.length,
      Math.max(finiteNumber(state.planCursor, 0) + 1, state.completedTrades)
    );
    state.selectionNonce += 1;
    state.candidates = removeCandidatesInvolvingTeams(state.candidates, [
      candidate.fromTeamName,
      candidate.toTeamName,
    ]);
    state.stats.completedTrades = state.completedTrades;
    state.stats.lastExecution = {
      date: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      result: "completed",
      candidateId: candidate.bankId || candidate.id,
      teams: [candidate.fromTeamName, candidate.toTeamName],
      bankSize: state.candidates.length,
    };
    state.stats.processingMs += Date.now() - startedAt;
    state.updatedAt = new Date().toISOString();
    if (executionTraceEnabled) {
      recordCpuTradeTrace("bank", "execution_completed", {
        currentDate: context?.currentDate || "",
        dayIndex: finiteNumber(context?.dayIndex, 0),
        candidateId: candidate.bankId || candidate.id,
        teams: [candidate.fromTeamName, candidate.toTeamName],
        executionMs,
        bankSizeAfter: state.candidates.length,
        completedTrades: state.completedTrades,
      });
    }

    return {
      ...result,
      leagueData: {
        ...result.leagueData,
        [CPU_TRADE_BANK_FIELD]: state,
      },
      state,
      changed: true,
      executed: true,
      reason: "completed",
    };
  }

  state.candidates = state.candidates.filter((row) => !staleIds.has(row.bankId || row.id));
  state.stats.executionDeferrals += 1;
  state.selectionNonce += 1;
  state.stats.lastExecution = {
    date: context?.currentDate || "",
    dayIndex: finiteNumber(context?.dayIndex, 0),
    result: "deferred_no_valid_candidate",
    removed: staleIds.size,
    bankSize: state.candidates.length,
    reason: lastFailure?.reason || "",
  };
  state.stats.processingMs += Date.now() - startedAt;
  state.updatedAt = new Date().toISOString();
  if (executionTraceEnabled) {
    recordCpuTradeTrace("bank", "execution_deferred", {
      currentDate: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      reason: "no_valid_candidate",
      removedCandidates: staleIds.size,
      bankSizeAfter: state.candidates.length,
      lastFailure: lastFailure?.reason || lastFailure?.staleCode || "",
    });
  }

  return {
    leagueData: {
      ...ensured.leagueData,
      [CPU_TRADE_BANK_FIELD]: state,
    },
    state,
    changed: true,
    executed: false,
    tradeRecord: null,
    reason: "no_valid_candidate",
    lastFailure,
  };
}

export function revalidateCpuTradeBankSlice({
  leagueData,
  context = {},
  testConfig = {},
  maxChecks = 1,
} = {}) {
  const startedAt = Date.now();
  const ensured = ensureCpuTradeBankState(leagueData, context, testConfig);
  if (!ensured.state || !ensured.state.candidates.length || !isBeforeDeadline(context)) {
    return {
      leagueData: ensured.leagueData || leagueData,
      state: ensured.state,
      changed: ensured.changed,
      checked: 0,
      removed: 0,
    };
  }

  const state = {
    ...ensured.state,
    candidates: [...ensured.state.candidates],
    stats: makeStats(ensured.state.stats),
  };
  const checks = clamp(Math.trunc(finiteNumber(maxChecks, 1)), 1, 16);
  let checked = 0;
  let removed = 0;
  let cursor = Math.max(0, Math.trunc(finiteNumber(state.pruneCursor, 0)));
  const userTeamName = getContextUserTeamName(context, ensured.leagueData);
  const validationCacheScope = buildSameStateValidationCacheScope(
    ensured.leagueData,
    context,
    state
  );
  prepareSameStateValidationCache(validationCacheScope);

  if (userTeamName) {
    const candidatesBeforeUserLock = state.candidates.length;
    state.candidates = state.candidates.filter(
      (candidate) => !candidateInvolvesTeam(candidate, userTeamName)
    );
    const userLockedCandidatesRemoved =
      candidatesBeforeUserLock - state.candidates.length;

    if (userLockedCandidatesRemoved > 0) {
      removed += userLockedCandidatesRemoved;
      state.stats.staleCandidatesRemoved += userLockedCandidatesRemoved;
      for (let index = 0; index < userLockedCandidatesRemoved; index += 1) {
        bumpReason(state.stats, "user_team_locked");
      }
    }
  }

  while (checked < checks && state.candidates.length) {
    const index = cursor % state.candidates.length;
    const candidate = state.candidates[index];
    const signature = candidate?.signature || getCpuTradeCandidateSignature(candidate);
    const cacheLookupStartedAt = cpuTradeNow();
    let validation = sameStateValidationCache.get(signature) || null;
    const validationCacheHit = Boolean(validation);
    recordCpuTradeTiming("sameStateValidationCacheLookupMs", cpuTradeNow() - cacheLookupStartedAt, {
      phase: "periodic",
      hit: validationCacheHit,
    });

    if (validationCacheHit) {
      state.stats.sameStateValidationCacheHits += 1;
      state.stats.sameStatePeriodicCacheHits += 1;
    } else {
      if (context?.recordsByTeam && typeof context.recordsByTeam === "object") {
        state.stats.recordSnapshotValidationCalls += 1;
      }
      const validationStartedAt = cpuTradeNow();
      validation = validateCpuTradeCandidateOnLeague({
        leagueData: ensured.leagueData,
        candidate,
        currentDate: context?.currentDate || "",
        tradeDeadlineDate: context?.tradeDeadlineDate || "",
        inOffseason: Boolean(context?.inOffseason),
        recordsByTeam: context?.recordsByTeam || null,
      });
      const validationMs = cpuTradeNow() - validationStartedAt;
      recordCpuTradeTiming("periodicRevalidationMs", validationMs, { phase: "periodic" });
      recordCpuTradeTiming("exactValidationMs", validationMs, { phase: "periodic" });
      recordCpuTradeValidation({
        phase: "periodic",
        signature,
        candidate,
        leagueData: ensured.leagueData,
        context,
        result: validation,
        durationMs: validationMs,
      });
      rememberSameStateValidation(signature, validation);
    }

    checked += 1;

    if (!validation.ok) {
      state.candidates.splice(index, 1);
      state.stats.staleCandidatesRemoved += 1;
      bumpReason(state.stats, validation?.staleCode || "periodic_revalidation_failed");
      removed += 1;
      continue;
    }

    state.candidates[index] = {
      ...candidate,
      priority: finiteNumber(validation?.evaluation?.score, candidate?.priority || 0),
      bankMeta: {
        ...(candidate?.bankMeta || {}),
        fromTeamScore: finiteNumber(validation?.fromTeamView?.score, 0),
        toTeamScore: finiteNumber(validation?.toTeamView?.score, 0),
        lastValidatedDate: context?.currentDate || "",
        validationCount: finiteNumber(candidate?.bankMeta?.validationCount, 0) + 1,
      },
    };
    cursor = index + 1;
  }

  state.pruneCursor = state.candidates.length ? cursor % state.candidates.length : 0;
  state.updatedAt = new Date().toISOString();
  const revalidationPassMs = Date.now() - startedAt;
  state.stats.processingMs += revalidationPassMs;
  recordCpuTradeTiming("periodicRevalidationPassMs", revalidationPassMs, {
    checked,
    removed,
  });

  return {
    leagueData: {
      ...ensured.leagueData,
      [CPU_TRADE_BANK_FIELD]: state,
    },
    state,
    changed: ensured.changed || checked > 0,
    checked,
    removed,
  };
}

export function pruneCpuTradeBankAfterExternalChange({
  leagueData,
  teamNames = [],
  reason = "external_change",
} = {}) {
  const existing = leagueData?.[CPU_TRADE_BANK_FIELD];
  if (!existing || !Array.isArray(existing.candidates) || !teamNames.length) {
    return { leagueData, changed: false, removed: 0 };
  }

  const candidates = removeCandidatesInvolvingTeams(existing.candidates, teamNames);
  const removed = existing.candidates.length - candidates.length;
  if (!removed) return { leagueData, changed: false, removed: 0 };

  const state = {
    ...existing,
    candidates,
    stats: makeStats(existing.stats),
    updatedAt: new Date().toISOString(),
  };
  state.stats.staleCandidatesRemoved += removed;
  bumpReason(state.stats, reason);

  return {
    leagueData: {
      ...leagueData,
      [CPU_TRADE_BANK_FIELD]: state,
    },
    changed: true,
    removed,
  };
}

export function readCpuTradeBankTestConfig() {
  try {
    const raw = globalThis?.localStorage?.getItem(CPU_TRADE_BANK_TEST_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCpuTradeBankTestConfig(patch = {}) {
  const next = {
    ...readCpuTradeBankTestConfig(),
    ...(patch && typeof patch === "object" ? patch : {}),
  };
  try {
    globalThis?.localStorage?.setItem(CPU_TRADE_BANK_TEST_CONFIG_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function clearCpuTradeBankTestConfig() {
  try {
    globalThis?.localStorage?.removeItem(CPU_TRADE_BANK_TEST_CONFIG_KEY);
  } catch {}
  return {};
}

export function buildCpuTradeBankSummary(leagueData = {}) {
  const state = leagueData?.[CPU_TRADE_BANK_FIELD];
  if (!state) {
    return {
      active: false,
      message: "No CPU trade bank has been initialized for this season.",
    };
  }

  const stats = makeStats(state.stats);
  const packageTypes = {};
  for (const candidate of state.candidates || []) {
    const fromPlayers = candidate.fromItems.filter((item) => item?.type === "player").length;
    const toPlayers = candidate.toItems.filter((item) => item?.type === "player").length;
    const picks = [...candidate.fromItems, ...candidate.toItems].filter((item) => item?.type === "pick").length;
    const key = `${fromPlayers}v${toPlayers}${picks ? `+${picks}pick` : ""}`;
    packageTypes[key] = finiteNumber(packageTypes[key], 0) + 1;
  }

  return {
    active: true,
    version: state.version,
    seasonYear: state.seasonYear,
    targetTrades: state.targetTrades,
    minimumTrades: getCpuTradeMinimumTarget(state),
    maximumGenerationPasses: finiteNumber(state.maximumGenerationPasses, 0),
    maximumExactEvaluations: finiteNumber(state.maximumExactEvaluations, 0),
    completedTrades: state.completedTrades,
    remainingTarget: Math.max(0, state.targetTrades - state.completedTrades),
    remainingMinimum: Math.max(0, getCpuTradeMinimumTarget(state) - state.completedTrades),
    bankSize: state.candidates.length,
    nextPlannedDay: state.executionPlanDays?.[state.planCursor] ?? null,
    generationNonce: state.generationNonce,
    packageTypes,
    rejectionReasons: { ...stats.rejectionReasons },
    stats,
  };
}
