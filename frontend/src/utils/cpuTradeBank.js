import {
  executeCpuMegaTradeCandidateOnLeagueLoose,
  executeCpuTradeCandidateOnLeague,
  validateCpuTradeCandidateOnLeague,
} from "./tradeExecution.js";
import { normalizeDraftPickAsset, normalizeTeamName } from "./draftPicks.js";
import { getContractSeasonYear } from "./seasonContext.js";
import {
  countStandardRosterPlayers,
  TRADE_TEMPORARY_STANDARD_ROSTER_MAX,
} from "./rosterRules.js";
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
export const CPU_TRADE_BANK_VERSION = 14;
export const CPU_TRADE_BANK_TEST_CONFIG_KEY = "bm_cpu_trade_bank_test_config_v1";

const TARGET_MIN = CPU_TRADE_CONTINUOUS_MIN_TARGET;
const TARGET_MAX = CPU_TRADE_CONTINUOUS_MAX_TARGET;
const MAX_BANK_SIZE = 48;
const MAX_BANK_ENTRIES_PER_TEAM = 3;
const FIRST_EXECUTION_DAY = 1;
const MAX_GENERATION_CANDIDATES_PER_PASS = 120;
const MAX_EXACT_EVALUATIONS_PER_PASS = 72;
const MAX_SAME_STATE_VALIDATION_CACHE = 512;
const MEGA_TRADE_FIRST_DAY = 45;
// The bonus mega trade is planned quietly during the season and executed with
// timing variance before the deadline.  It must never become a deadline-day
// brute-force search.
const MEGA_TRADE_PLANNER_VERSION = 2;
const MEGA_TRADE_PLANNING_LEAD_DAYS = 28;
const MEGA_TRADE_PLAN_RETRY_DAYS = 7;
const MEGA_TRADE_EXECUTION_RETRY_DAYS = 3;
const MEGA_TRADE_EXECUTION_MIN_LEAD_DAYS = 6;
const MEGA_TRADE_EXECUTION_MAX_LEAD_DAYS = 18;
const MEGA_TRADE_PLAN_MAX_CANDIDATES = 28;
const MEGA_TRADE_EXECUTION_FALLBACK_CHECKS = 10;
// Legacy export helper default; the Calendar no longer uses the old deadline sweep.
const MEGA_TRADE_DIRECT_SWEEP_CHECKS = MEGA_TRADE_EXECUTION_FALLBACK_CHECKS;
const MEGA_TRADE_FAST_MAX_TARGETS = 10;
const MEGA_TRADE_FAST_MAX_BUYERS = 12;
const MEGA_TRADE_FAST_MAX_CANDIDATES = 96;

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
    if (row.cpuMegaTrade || row.megaTrade || row.tradeType === "cpu_mega_trade") return false;
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
    megaGenerationPasses: finiteNumber(existing.megaGenerationPasses, 0),
    megaExactEvaluations: finiteNumber(existing.megaExactEvaluations, 0),
    megaCandidatesAccepted: finiteNumber(existing.megaCandidatesAccepted, 0),
    megaTradesCompleted: finiteNumber(existing.megaTradesCompleted, 0),
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

function buildMegaTradeState({ seed = "", seasonYear = 2026, deadlineDay = 120 } = {}) {
  const random = seededRandom(`${seed}|mega-trade-plan:${seasonYear}`);
  const normalizedDeadline = Math.max(MEGA_TRADE_FIRST_DAY + 12, Math.trunc(finiteNumber(deadlineDay, 120)));
  const executionLeadDays = MEGA_TRADE_EXECUTION_MIN_LEAD_DAYS + Math.floor(
    random() * (MEGA_TRADE_EXECUTION_MAX_LEAD_DAYS - MEGA_TRADE_EXECUTION_MIN_LEAD_DAYS + 1)
  );
  const executionDayIndex = Math.max(MEGA_TRADE_FIRST_DAY + 8, normalizedDeadline - executionLeadDays);
  const planningStartDayIndex = Math.max(
    MEGA_TRADE_FIRST_DAY,
    executionDayIndex - MEGA_TRADE_PLANNING_LEAD_DAYS
  );

  return {
    plannerVersion: MEGA_TRADE_PLANNER_VERSION,
    seasonYear,
    status: "pending",
    planningStartDayIndex,
    executionDayIndex,
    // Keep targetDayIndex for old diagnostics/UI consumers, but it now means
    // the prepared execution date rather than a broad generation date.
    targetDayIndex: executionDayIndex,
    attempts: 0,
    maxAttempts: 8,
    nextAttemptDayIndex: planningStartDayIndex,
    lastAttemptDayIndex: null,
    lastAttemptDate: null,
    lastSkippedReason: null,
    plannedCandidate: null,
    plannedCandidates: [],
    plannedAtDayIndex: null,
    plannedAtDate: null,
    candidateBankId: null,
    candidateSignature: null,
    executedTradeId: null,
    executedDate: null,
    executedTeams: [],
    targetPlayerName: "",
    diagnostics: {
      planningPasses: 0,
      candidatesFound: 0,
      executionChecks: 0,
      lastAction: "created",
      lastReason: null,
    },
  };
}

function normalizeMegaTradeState(existing, { seed = "", seasonYear = 2026, deadlineDay = 120 } = {}) {
  const fallback = buildMegaTradeState({ seed, seasonYear, deadlineDay });
  if (!existing || typeof existing !== "object" || Number(existing.seasonYear) !== Number(seasonYear)) {
    return fallback;
  }

  // Migrate the old deadline-sweep state in place without resetting the normal
  // CPU trade bank. Completed mega trades remain completed; every unfinished
  // legacy state becomes a fresh season-long plan.
  if (Number(existing.plannerVersion) !== MEGA_TRADE_PLANNER_VERSION) {
    if (String(existing.status || "") === "completed") {
      return {
        ...fallback,
        ...existing,
        plannerVersion: MEGA_TRADE_PLANNER_VERSION,
        seasonYear,
        status: "completed",
        plannedCandidate: null,
      };
    }
    return fallback;
  }

  const status = String(existing.status || "pending");
  const allowedStatus = new Set(["pending", "planned", "completed"]);
  const executionDayIndex = Math.trunc(finiteNumber(existing.executionDayIndex, fallback.executionDayIndex));
  const planningStartDayIndex = Math.trunc(finiteNumber(existing.planningStartDayIndex, fallback.planningStartDayIndex));
  return {
    ...fallback,
    ...existing,
    plannerVersion: MEGA_TRADE_PLANNER_VERSION,
    seasonYear,
    status: allowedStatus.has(status) ? status : "pending",
    planningStartDayIndex,
    executionDayIndex,
    targetDayIndex: executionDayIndex,
    attempts: Math.trunc(finiteNumber(existing.attempts, 0)),
    maxAttempts: Math.max(1, Math.trunc(finiteNumber(existing.maxAttempts, 8))),
    nextAttemptDayIndex: Math.trunc(
      finiteNumber(existing.nextAttemptDayIndex, status === "planned" ? executionDayIndex : planningStartDayIndex)
    ),
    plannedCandidate:
      existing.plannedCandidate && typeof existing.plannedCandidate === "object"
        ? existing.plannedCandidate
        : null,
    plannedCandidates: Array.isArray(existing.plannedCandidates)
      ? existing.plannedCandidates.filter((row) => row && typeof row === "object").slice(0, MEGA_TRADE_EXECUTION_FALLBACK_CHECKS)
      : (existing.plannedCandidate && typeof existing.plannedCandidate === "object" ? [existing.plannedCandidate] : []),
    executedTeams: Array.isArray(existing.executedTeams) ? existing.executedTeams : [],
    diagnostics:
      existing.diagnostics && typeof existing.diagnostics === "object"
        ? { ...fallback.diagnostics, ...existing.diagnostics }
        : { ...fallback.diagnostics },
  };
}

function isMegaTradeCandidate(candidate = {}) {
  return Boolean(
    candidate?.megaTrade ||
      candidate?.cpuMegaTrade ||
      candidate?.tradeType === "cpu_mega_trade" ||
      candidate?.debug?.megaTrade ||
      candidate?.bankMeta?.megaTrade
  );
}

function createBankState(leagueData, context, testConfig = {}) {
  const seasonYear = getSeasonYear(leagueData, context);
  const seed = randomSeedToken(seasonYear, testConfig?.seed || "");
  const random = seededRandom(`${seed}|target`);
  const targetRoll = random();
  const targetBandRoll = random();
  let baseTargetTrades;
  if (targetRoll < 0.18) {
    baseTargetTrades = 27 + Math.floor(targetBandRoll * 2);
  } else if (targetRoll < 0.86) {
    baseTargetTrades = 29 + Math.floor(targetBandRoll * 3);
  } else {
    baseTargetTrades = 32 + Math.floor(targetBandRoll * 2);
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
    megaTradeState: buildMegaTradeState({ seed, seasonYear, deadlineDay }),
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
  const hadLegacyMegaCandidates = Array.isArray(existing.candidates) && existing.candidates.some(isMegaTradeCandidate);
  const megaPlannerNeedsMigration = Number(existing?.megaTradeState?.plannerVersion) !== MEGA_TRADE_PLANNER_VERSION;
  const normalizationChanged =
    !Array.isArray(existing.candidates) ||
    hadLegacyMegaCandidates ||
    megaPlannerNeedsMigration ||
    !existing.stats ||
    typeof existing.stats !== "object" ||
    !Number.isFinite(Number(existing.baseTargetTrades)) ||
    existing.leagueTeamFingerprint !== fingerprint ||
    Number(existing.completedTrades) !== completedTrades;
  const state = {
    ...existing,
    // Mega trades live only in megaTradeState.plannedCandidates. Purge legacy
    // mega rows from the normal bank so they cannot affect normal trade timing,
    // evaluator work, or inventory pressure.
    candidates: Array.isArray(existing.candidates)
      ? existing.candidates.filter((candidate) => !isMegaTradeCandidate(candidate))
      : [],
    stats: makeStats(existing.stats),
    leagueTeamFingerprint: fingerprint,
    completedTrades,
  };

  const deadlineDay = Math.max(
    FIRST_EXECUTION_DAY + 1,
    Math.trunc(
      finiteNumber(
        context?.deadlineDayIndex,
        finiteNumber(context?.dayIndex, 0) + finiteNumber(context?.daysToDeadline, 120)
      )
    )
  );
  state.megaTradeState = normalizeMegaTradeState(state.megaTradeState, {
    seed: state.seed,
    seasonYear,
    deadlineDay,
  });

  const random = seededRandom(`${state.seed}|target`);
  const targetRoll = random();
  const targetBandRoll = random();
  let generatedBaseTarget;
  if (targetRoll < 0.18) {
    generatedBaseTarget = 27 + Math.floor(targetBandRoll * 2);
  } else if (targetRoll < 0.86) {
    generatedBaseTarget = 29 + Math.floor(targetBandRoll * 3);
  } else {
    generatedBaseTarget = 32 + Math.floor(targetBandRoll * 2);
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
    megaTrade: isMegaTradeCandidate(candidate),
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
      megaTrade: isMegaTradeCandidate(candidate),
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
  const megaBonus = isMegaTradeCandidate(candidate) ? 28.0 : 0.0;
  return priority + tierBonus + megaBonus + Math.min(1.6, assetCount * 0.18) + Math.min(1.4, firstCount * 0.7) + seededJitter * 1.05;
}

function rankCandidatesForExecution(candidates = [], state = {}, context = {}) {
  const seed = `${state?.seed || ""}|selection-quality:${state?.selectionNonce || 0}|${context?.currentDate || context?.dayIndex || ""}`;
  return [...candidates]
    .map((candidate) => ({
      candidate,
      score: candidateTradeQualityScore(candidate, seed) + (isMegaTradeCandidate(candidate) ? 1000 : 0),
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
  const exactEvaluations = Math.max(0, finiteNumber(state?.stats?.exactEvaluations, 0) - finiteNumber(state?.stats?.megaExactEvaluations, 0));
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

export function getCpuMegaTradeGenerationPolicy(state, context = {}, testConfig = {}) {
  if (!state || !isBeforeDeadline(context) || testConfig?.disableMegaTrade) {
    return { shouldGenerate: false, action: "none", reason: "timing_locked" };
  }

  const mega = normalizeMegaTradeState(state?.megaTradeState, {
    seed: state?.seed || "",
    seasonYear: state?.seasonYear || getSeasonYear({}, context),
    deadlineDay: context?.deadlineDayIndex,
  });
  const dayIndex = Math.max(0, Math.trunc(finiteNumber(context?.dayIndex, 0)));
  const daysToDeadline = finiteNumber(context?.daysToDeadline, 999);

  if (mega.status === "completed") {
    return { shouldGenerate: false, action: "none", reason: "mega_completed" };
  }

  if (mega.status === "planned" && mega.plannedCandidate) {
    if (dayIndex >= mega.executionDayIndex) {
      return {
        shouldGenerate: true,
        action: "execute",
        reason: "prepared_mega_execution_due",
        maxCandidateChecks: MEGA_TRADE_EXECUTION_FALLBACK_CHECKS,
        executionDayIndex: mega.executionDayIndex,
      };
    }
    return {
      shouldGenerate: false,
      action: "none",
      reason: "prepared_mega_waiting",
      executionDayIndex: mega.executionDayIndex,
    };
  }

  const nextAttemptDayIndex = Math.trunc(
    finiteNumber(mega.nextAttemptDayIndex, mega.planningStartDayIndex)
  );
  if (dayIndex >= mega.planningStartDayIndex && dayIndex >= nextAttemptDayIndex) {
    // Planning is a tiny local recipe pass. No Python worker, no trade evaluator,
    // no exact-validation pool and no deadline-day sweep.
    return {
      shouldGenerate: true,
      action: dayIndex >= mega.executionDayIndex ? "plan_and_execute" : "plan",
      reason: dayIndex >= mega.executionDayIndex ? "late_lightweight_plan" : "mega_plan_due",
      maxCandidateChecks: MEGA_TRADE_EXECUTION_FALLBACK_CHECKS,
      executionDayIndex: mega.executionDayIndex,
    };
  }

  // A final tiny retry is allowed before trades close, but it is still capped at
  // four simple legal recipes and never invokes the normal evaluator.
  if (daysToDeadline > 0 && daysToDeadline <= 6) {
    return {
      shouldGenerate: true,
      action: "plan_and_execute",
      reason: "final_guaranteed_mega_retry",
      maxCandidateChecks: MEGA_TRADE_EXECUTION_FALLBACK_CHECKS,
      executionDayIndex: dayIndex,
    };
  }

  return {
    shouldGenerate: false,
    action: "none",
    reason: "mega_plan_not_due",
    nextAttemptDayIndex,
    executionDayIndex: mega.executionDayIndex,
  };
}

export function buildCpuMegaTradeWorkerContext(state, context = {}, policy = {}) {
  return {
    ...buildCpuTradeWorkerContext(state, context, { ...policy, maxCandidates: policy?.maxCandidates || 18 }),
    megaTradeMode: true,
    megaTradeHardSweep: Boolean(policy?.hardSweep),
    foregroundRecommended: true,
    inventoryPressure: 0,
    generationNonce: finiteNumber(state?.generationNonce, 0) + finiteNumber(state?.megaTradeState?.attempts, 0) + (policy?.hardSweep ? 1000 : 0),
  };
}

function replaceTradeRecordInLeague(leagueData = {}, tradeRecord = {}) {
  if (!tradeRecord || typeof tradeRecord !== "object") return leagueData;
  const tradeId = tradeRecord.id || tradeRecord.bankId || "";
  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  let replaced = false;
  const nextHistory = history.map((row, index) => {
    const rowId = row?.id || row?.bankId || "";
    const sameId = tradeId && rowId && String(rowId) === String(tradeId);
    const isLast = index === history.length - 1;
    if (sameId || (!replaced && isLast)) {
      replaced = true;
      return tradeRecord;
    }
    return row;
  });
  return {
    ...leagueData,
    tradeHistory: replaced ? nextHistory : [...history, tradeRecord],
    lastTrade: tradeRecord,
  };
}


function playerDisplayName(player = {}) {
  return player?.name || player?.player || player?.playerName || "Unknown Player";
}

function playerOvr(player = {}) {
  return finiteNumber(player?.overall ?? player?.ovr ?? player?.rating, 0);
}

function playerPot(player = {}) {
  return finiteNumber(player?.potential ?? player?.pot, playerOvr(player));
}

function playerAge(player = {}) {
  return finiteNumber(player?.age ?? player?.playerAge, 0);
}

function getMegaTradePayrollSeasonYear(leagueData = {}) {
  try {
    return getContractSeasonYear(leagueData || {});
  } catch {
    return Math.trunc(finiteNumber(leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.seasonStartYear, 2026)) + 1;
  }
}

function getMegaPlayerSalary(player = {}, leagueData = {}) {
  const payrollYear = getMegaTradePayrollSeasonYear(leagueData);
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear.map((value) => Number(value) || 0) : [];
  if (salaries.length) {
    let startYear = Number(contract.startYear || payrollYear);
    let idx = payrollYear - startYear;
    if (salaries.length === 1 && startYear === payrollYear - 1 && (idx < 0 || idx >= salaries.length)) idx = 0;
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (idx >= salaries.length) idx = salaries.length - 1;
    return Math.max(0, Number(salaries[idx] || 0));
  }
  const fallback = Number(player?.salary ?? player?.currentSalary ?? player?.contractSalary ?? player?.capHit ?? player?.aav ?? 0);
  return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
}

function recordForTeamName(context = {}, teamName = "") {
  if (!teamName) return null;
  const rows = context?.recordsByTeam || {};
  const key = Object.keys(rows).find((name) => sameTeam(name, teamName));
  return key ? rows[key] : null;
}

function winPctForTeam(context = {}, teamName = "") {
  const row = recordForTeamName(context, teamName) || {};
  const wins = finiteNumber(row.wins ?? row.w, 0);
  const losses = finiteNumber(row.losses ?? row.l, 0);
  const games = finiteNumber(row.games ?? row.gp, wins + losses);
  if (games <= 0) return null;
  return wins / Math.max(1, wins + losses || games);
}

function gamesPlayedForTeam(context = {}, teamName = "") {
  const row = recordForTeamName(context, teamName) || {};
  const wins = finiteNumber(row.wins ?? row.w, 0);
  const losses = finiteNumber(row.losses ?? row.l, 0);
  return finiteNumber(row.games ?? row.gp, wins + losses);
}

function conferenceRankForTeam(leagueData = {}, context = {}, teamName = "") {
  if (!leagueData?.conferences || typeof leagueData.conferences !== "object" || !teamName) return null;
  for (const rows of Object.values(leagueData.conferences)) {
    if (!Array.isArray(rows) || !rows.some((team) => sameTeam(teamNameOf(team), teamName))) continue;
    const ranked = [...rows].sort((a, b) => {
      const ap = winPctForTeam(context, teamNameOf(a));
      const bp = winPctForTeam(context, teamNameOf(b));
      const ar = recordForTeamName(context, teamNameOf(a)) || {};
      const br = recordForTeamName(context, teamNameOf(b)) || {};
      if ((bp ?? -1) !== (ap ?? -1)) return (bp ?? -1) - (ap ?? -1);
      return finiteNumber(br.wins ?? br.w, 0) - finiteNumber(ar.wins ?? ar.w, 0);
    });
    const index = ranked.findIndex((team) => sameTeam(teamNameOf(team), teamName));
    return index >= 0 ? index + 1 : null;
  }
  return null;
}

function megaLeagueRankForTeam(leagueData = {}, context = {}, teamName = "") {
  const teams = getAllTeams(leagueData);
  if (!teamName || !teams.length) return null;
  const rows = teams.map((team) => ({
    team,
    name: teamNameOf(team),
    pct: winPctForTeam(context, teamNameOf(team)),
    games: gamesPlayedForTeam(context, teamNameOf(team)),
    power: teamTopOvr(team, 6),
  }));
  const useRecord = rows.filter((row) => row.games >= 20).length >= Math.max(1, Math.ceil(rows.length * 0.8));
  rows.sort((a, b) => {
    const aScore = useRecord ? (a.pct ?? 0) * 50 + a.power * 0.5 : a.power;
    const bScore = useRecord ? (b.pct ?? 0) * 50 + b.power * 0.5 : b.power;
    if (bScore !== aScore) return bScore - aScore;
    if ((b.pct ?? -1) !== (a.pct ?? -1)) return (b.pct ?? -1) - (a.pct ?? -1);
    return b.power - a.power;
  });
  const index = rows.findIndex((row) => sameTeam(row.name, teamName));
  return index >= 0 ? index + 1 : null;
}

function buildMegaDirectionMap(leagueData = {}, context = {}) {
  const teams = getAllTeams(leagueData);
  const baseRows = teams.map((team) => {
    const teamName = teamNameOf(team);
    return {
      team,
      teamName,
      pct: winPctForTeam(context, teamName),
      games: gamesPlayedForTeam(context, teamName),
      power: teamTopOvr(team, 6),
      conferenceRank: null,
      leagueRank: null,
    };
  });

  const useRecord = baseRows.filter((row) => row.games >= 20).length >= Math.max(1, Math.ceil(baseRows.length * 0.8));
  [...baseRows]
    .sort((a, b) => {
      const aScore = useRecord ? (a.pct ?? 0) * 50 + a.power * 0.5 : a.power;
      const bScore = useRecord ? (b.pct ?? 0) * 50 + b.power * 0.5 : b.power;
      if (bScore !== aScore) return bScore - aScore;
      return (b.pct ?? -1) - (a.pct ?? -1);
    })
    .forEach((row, index) => { row.leagueRank = index + 1; });

  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    for (const teamsInConference of Object.values(leagueData.conferences)) {
      if (!Array.isArray(teamsInConference)) continue;
      const conferenceNames = new Set(teamsInConference.map((team) => normalizeTeamName(teamNameOf(team))));
      baseRows
        .filter((row) => conferenceNames.has(normalizeTeamName(row.teamName)))
        .sort((a, b) => {
          if ((b.pct ?? -1) !== (a.pct ?? -1)) return (b.pct ?? -1) - (a.pct ?? -1);
          const ar = recordForTeamName(context, a.teamName) || {};
          const br = recordForTeamName(context, b.teamName) || {};
          return finiteNumber(br.wins ?? br.w, 0) - finiteNumber(ar.wins ?? ar.w, 0);
        })
        .forEach((row, index) => { row.conferenceRank = index + 1; });
    }
  }

  const out = new Map();
  for (const row of baseRows) {
    let phase = "middle";
    if (row.conferenceRank != null) {
      if (row.conferenceRank >= 12) phase = "rebuilding";
      else if (row.conferenceRank >= 8) phase = "retooling";
      else phase = "contending";
    } else if ((row.pct != null && row.pct <= 0.38) || (row.leagueRank != null && row.leagueRank >= 24)) {
      phase = "rebuilding";
    } else if ((row.pct != null && row.pct < 0.5) || (row.leagueRank != null && row.leagueRank >= 16)) {
      phase = "retooling";
    }
    const under500 = row.pct != null && row.pct < 0.5;
    const bottomHalf = row.leagueRank != null && row.leagueRank >= 16;
    out.set(normalizeTeamName(row.teamName), {
      phase,
      pct: row.pct,
      games: row.games,
      conferenceRank: row.conferenceRank,
      leagueRank: row.leagueRank,
      under500,
      bottomHalf,
      eligible: phase === "retooling" || phase === "rebuilding" || under500 || bottomHalf,
    });
  }
  return out;
}

function megaSellerDirection(leagueData = {}, context = {}, sellerTeam = {}) {
  const teamName = teamNameOf(sellerTeam);
  const pct = winPctForTeam(context, teamName);
  const games = gamesPlayedForTeam(context, teamName);
  const conferenceRank = conferenceRankForTeam(leagueData, context, teamName);
  const leagueRank = megaLeagueRankForTeam(leagueData, context, teamName);
  let phase = "middle";
  if (conferenceRank != null) {
    if (conferenceRank >= 12) phase = "rebuilding";
    else if (conferenceRank >= 8) phase = "retooling";
    else phase = "contending";
  } else if ((pct != null && pct <= 0.38) || (leagueRank != null && leagueRank >= 24)) {
    phase = "rebuilding";
  } else if ((pct != null && pct < 0.5) || (leagueRank != null && leagueRank >= 16)) {
    phase = "retooling";
  }
  const under500 = pct != null && pct < 0.5;
  const bottomHalf = leagueRank != null && leagueRank >= 16;
  return {
    phase,
    pct,
    games,
    conferenceRank,
    leagueRank,
    under500,
    bottomHalf,
    eligible: phase === "retooling" || phase === "rebuilding" || under500 || bottomHalf,
  };
}

function strictMegaSellerBlockReason(leagueData = {}, context = {}, sellerTeam = {}, targetPlayer = null) {
  const direction = megaSellerDirection(leagueData, context, sellerTeam);
  if (direction.conferenceRank != null && direction.conferenceRank <= 7) return "seller_top7_conference";
  if (!direction.eligible) return "seller_not_mid_bad_retool_or_rebuild";
  if (targetPlayer) {
    const ovr = playerOvr(targetPlayer);
    const age = playerAge(targetPlayer);
    if (ovr < 90) return "mega_target_below_90";
    if (age < 28) return "mega_target_too_young";
    // Final intended rule: only a true rebuilding team may move a 94+ star
    // aged 30 or younger. Retooling and generic mid/bad teams protect them.
    if (direction.phase !== "rebuilding" && ovr >= 94 && age <= 30) {
      return "retool_or_mid_protects_prime_94_plus";
    }
  }
  return "";
}

function teamTopOvr(team = {}, count = 6) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const values = players.map(playerOvr).filter((value) => value > 0).sort((a, b) => b - a).slice(0, count);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isYoungMegaCore(player = {}) {
  const age = playerAge(player);
  const ovr = playerOvr(player);
  const pot = playerPot(player);
  if (age <= 25 && pot >= 93) return true;
  if (age <= 24 && ovr >= 88 && pot >= 90) return true;
  return false;
}

function isProtectedBuyerCore(player = {}, buyerTeam = {}) {
  const age = playerAge(player);
  const ovr = playerOvr(player);
  const pot = playerPot(player);
  if (isYoungMegaCore(player)) return true;
  if (ovr >= 90) return true;
  const sorted = [...(buyerTeam?.players || [])].sort((a, b) => playerOvr(b) - playerOvr(a));
  const rank = sorted.findIndex((row) => {
    const aid = row?.id ?? row?.playerId ?? row?.uuid ?? null;
    const bid = player?.id ?? player?.playerId ?? player?.uuid ?? null;
    if (aid != null && bid != null) return String(aid) === String(bid);
    return normalizeTeamName(playerDisplayName(row)) === normalizeTeamName(playerDisplayName(player));
  });
  if (rank >= 0 && rank <= 1 && age <= 27 && pot >= 88) return true;
  return false;
}

function activeFirstPicksForTeam(leagueData = {}, teamName = "", limit = 4) {
  const seasonYear = getSeasonYear(leagueData, {});
  const teamNames = getAllTeams(leagueData).map((team) => teamNameOf(team)).filter(Boolean);
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [])
    .map((pick, index) => ({ raw: pick, normalized: normalizeDraftPickAsset(pick, index, teamNames) }))
    .filter(({ normalized }) => {
      const owner = normalized?.ownerTeam || normalized?.currentOwnerTeamName || normalized?.owner || "";
      const round = finiteNumber(normalized?.round, 2);
      const year = finiteNumber(normalized?.year ?? normalized?.seasonYear, 0);
      const status = String(normalized?.status || "active").toLowerCase();
      return sameTeam(owner, teamName) && round === 1 && year >= seasonYear + 1 && status !== "traded" && status !== "conveyed";
    })
    .sort((a, b) => finiteNumber(a.normalized?.year ?? a.normalized?.seasonYear, 0) - finiteNumber(b.normalized?.year ?? b.normalized?.seasonYear, 0))
    .slice(0, limit)
    .map(({ raw, normalized }) => ({
      type: "pick",
      teamName,
      pick: compactPickReference({ ...raw, ...normalized }),
      protection: normalized?.protection || normalized?.protections || normalized?.displayProtection || raw?.protection || "Unprotected",
    }));
}

function playerTradeItem(player = {}, teamName = "") {
  return { type: "player", teamName, player: compactPlayerReference(player) };
}

function buildFastMegaTargets(leagueData = {}, context = {}, directionMap = null) {
  const userTeamName = getContextUserTeamName(context, leagueData);
  const teams = getAllTeams(leagueData);
  const directions = directionMap || buildMegaDirectionMap(leagueData, context);
  const rows = [];
  const used = new Set();

  const playerIdentityKey = (player = {}, teamName = "") => {
    const id = player?.id ?? player?.playerId ?? player?.uuid ?? "";
    return id ? `id:${id}` : `${normalizeTeamName(teamName)}:${normalizeTeamName(playerDisplayName(player))}`;
  };

  const addTarget = ({ team, teamName, direction, player, fallback = false, reason = "strict" }) => {
    const key = playerIdentityKey(player, teamName);
    if (!key || used.has(key)) return;
    used.add(key);
    const ovr = playerOvr(player);
    const age = playerAge(player);
    const pctPenalty = direction?.pct == null ? 0.08 : Math.max(0, 0.5 - direction.pct);
    const directionBonus = direction?.phase === "rebuilding" ? 16 : direction?.phase === "retooling" ? 10 : 5;
    const fallbackPenalty = fallback ? -42 : 0;
    rows.push({
      team,
      teamName,
      player,
      score:
        ovr * 10 +
        age * 0.8 +
        pctPenalty * 100 +
        Math.max(0, finiteNumber(direction?.leagueRank, 16) - 12) * 3 +
        directionBonus +
        fallbackPenalty,
      powerRank: direction?.leagueRank,
      conferenceRank: direction?.conferenceRank,
      sellerPhase: direction?.phase,
      winPct: direction?.pct,
      guaranteedMegaFallback: fallback,
      fallbackReason: reason,
    });
  };

  for (const team of teams) {
    const teamName = teamNameOf(team);
    if (!teamName || sameTeam(teamName, userTeamName)) continue;
    const direction = directions.get(normalizeTeamName(teamName)) || megaSellerDirection(leagueData, context, team);
    if (direction.conferenceRank != null && direction.conferenceRank <= 7) continue;
    if (!direction.eligible) continue;

    for (const player of team?.players || []) {
      const ovr = playerOvr(player);
      const age = playerAge(player);
      if (ovr < 90 || age < 28) continue;
      if (direction.phase !== "rebuilding" && ovr >= 94 && age <= 30) continue;
      if (isYoungMegaCore(player)) continue;
      addTarget({ team, teamName, direction, player, fallback: false, reason: "strict" });
    }
  }

  // Guarantee safety net: if the strict seller filter cannot find enough 90+
  // targets in a later season, add a tiny relaxed pool. These candidates are
  // still legal-checked and still exclude the controlled team, but they prevent
  // a season from reaching the deadline with zero possible mega-trade recipes.
  if (rows.length < MEGA_TRADE_FAST_MAX_TARGETS) {
    for (const team of teams) {
      const teamName = teamNameOf(team);
      if (!teamName || sameTeam(teamName, userTeamName)) continue;
      const direction = directions.get(normalizeTeamName(teamName)) || megaSellerDirection(leagueData, context, team);
      const hardTopSeed = direction?.conferenceRank != null && direction.conferenceRank <= 3;
      for (const player of team?.players || []) {
        const ovr = playerOvr(player);
        const age = playerAge(player);
        if (ovr < 90 || age < 26) continue;
        // Still protect the absolute apex young franchise piece unless the team
        // is truly buried; this keeps the fallback from randomly moving the best
        // 24-year-old in the league just to satisfy the guarantee.
        if (ovr >= 95 && age <= 27 && direction?.phase !== "rebuilding") continue;
        if (hardTopSeed && ovr >= 94) continue;
        addTarget({
          team,
          teamName,
          direction,
          player,
          fallback: true,
          reason: "relaxed_one_per_season_guarantee",
        });
      }
    }
  }

  const strictRows = rows.filter((row) => !row.guaranteedMegaFallback).sort((a, b) => b.score - a.score);
  const fallbackRows = rows.filter((row) => row.guaranteedMegaFallback).sort((a, b) => b.score - a.score);
  const strictTake = Math.max(4, MEGA_TRADE_FAST_MAX_TARGETS - Math.min(3, fallbackRows.length));
  return [
    ...strictRows.slice(0, strictTake),
    ...fallbackRows.slice(0, 3),
    ...strictRows.slice(strictTake),
  ].slice(0, MEGA_TRADE_FAST_MAX_TARGETS);
}

function buildFastMegaBuyers(leagueData = {}, context = {}, sellerName = "", directionMap = null) {
  const userTeamName = getContextUserTeamName(context, leagueData);
  const directions = directionMap || buildMegaDirectionMap(leagueData, context);
  return getAllTeams(leagueData)
    .filter((team) => {
      const name = teamNameOf(team);
      if (!name || sameTeam(name, userTeamName) || sameTeam(name, sellerName)) return false;
      const direction = directions.get(normalizeTeamName(name)) || {};
      const pct = direction.pct ?? winPctForTeam(context, name);
      const conferenceRank = direction.conferenceRank ?? null;
      return (conferenceRank != null && conferenceRank <= 7) || (pct != null ? pct >= 0.5 : teamTopOvr(team, 6) >= 82);
    })
    .map((team) => {
      const name = teamNameOf(team);
      const direction = directions.get(normalizeTeamName(name)) || {};
      const pct = direction.pct ?? winPctForTeam(context, name);
      const conferenceRank = direction.conferenceRank ?? null;
      const rankBonus = conferenceRank == null ? 0 : Math.max(0, 8 - conferenceRank) * 2.5;
      return {
        team,
        teamName: name,
        conferenceRank,
        score: (pct == null ? 0.55 : pct) * 100 + teamTopOvr(team, 6) * 2 + rankBonus,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MEGA_TRADE_FAST_MAX_BUYERS);
}

function buildBuyerSalaryCombos(leagueData = {}, buyerTeam = {}, targetSalary = 0) {
  const teamName = teamNameOf(buyerTeam);
  const candidates = (buyerTeam?.players || [])
    .filter((player) => !isProtectedBuyerCore(player, buyerTeam))
    .map((player) => ({
      player,
      salary: getMegaPlayerSalary(player, leagueData),
      ovr: playerOvr(player),
      age: playerAge(player),
      pot: playerPot(player),
    }))
    .filter((row) => row.salary > 0)
    .sort((a, b) => b.salary - a.salary || b.ovr - a.ovr)
    .slice(0, 9);

  const combos = [];
  const add = (rows) => {
    const key = rows.map((r) => r.player?.id ?? playerDisplayName(r.player)).join("|");
    if (!rows.length || combos.some((combo) => combo.key === key)) return;
    combos.push({
      key,
      rows,
      salary: rows.reduce((sum, row) => sum + row.salary, 0),
      ovrScore: rows.reduce((sum, row) => sum + row.ovr, 0),
      youthScore: rows.reduce((sum, row) => sum + (row.age <= 25 && row.pot >= 82 ? 1 : 0), 0),
    });
  };

  for (let i = 0; i < candidates.length; i += 1) add([candidates[i]]);
  for (let i = 0; i < Math.min(6, candidates.length); i += 1) {
    for (let j = i + 1; j < Math.min(7, candidates.length); j += 1) add([candidates[i], candidates[j]]);
  }
  for (let i = 0; i < Math.min(4, candidates.length); i += 1) {
    for (let j = i + 1; j < Math.min(6, candidates.length); j += 1) {
      for (let k = j + 1; k < Math.min(7, candidates.length); k += 1) add([candidates[i], candidates[j], candidates[k]]);
    }
  }

  // Build salary matching first instead of asking the normal evaluator to solve
  // it later. Most over-cap buyers need roughly 80%+ of the incoming star's
  // salary; seller-side matching remains safe below about 120%.
  const strictMin = Math.max(0, targetSalary * 0.78 - 500_000);
  const strictMax = targetSalary > 0 ? targetSalary * 1.18 + 500_000 : Number.POSITIVE_INFINITY;
  let useful = combos.filter((combo) => combo.salary >= strictMin && combo.salary <= strictMax);
  if (!useful.length) {
    // Cap-room teams can occasionally use a smaller outgoing package. Keep one
    // bounded fallback without opening a combinatorial search.
    const fallbackMin = Math.max(0, targetSalary * 0.64 - 750_000);
    useful = combos.filter((combo) => combo.salary >= fallbackMin && combo.salary <= strictMax);
  }

  return useful
    .sort((a, b) => {
      const aGap = Math.abs(a.salary - targetSalary * 0.9);
      const bGap = Math.abs(b.salary - targetSalary * 0.9);
      if (aGap !== bGap) return aGap - bGap;
      if (b.youthScore !== a.youthScore) return b.youthScore - a.youthScore;
      return b.ovrScore - a.ovrScore;
    })
    .slice(0, 4)
    .map((combo) => combo.rows.map((row) => playerTradeItem(row.player, teamName)));
}

function buildFastMegaCandidates(leagueData = {}, context = {}, state = {}, options = {}) {
  const seed = `${state?.seed || ""}|fast-mega:${context?.currentDate || context?.dayIndex || ""}`;
  const maxTargets = clamp(Math.trunc(finiteNumber(options?.maxTargets, MEGA_TRADE_FAST_MAX_TARGETS)), 1, MEGA_TRADE_FAST_MAX_TARGETS);
  const maxBuyers = clamp(Math.trunc(finiteNumber(options?.maxBuyers, MEGA_TRADE_FAST_MAX_BUYERS)), 1, MEGA_TRADE_FAST_MAX_BUYERS);
  const maxCandidates = clamp(Math.trunc(finiteNumber(options?.maxCandidates, MEGA_TRADE_FAST_MAX_CANDIDATES)), 1, MEGA_TRADE_FAST_MAX_CANDIDATES);
  const directionMap = buildMegaDirectionMap(leagueData, context);
  const randomTargets = shuffled(buildFastMegaTargets(leagueData, context, directionMap), seed)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTargets);
  const firstPickCache = new Map();
  const out = [];

  for (const targetRow of randomTargets) {
    const targetSalary = getMegaPlayerSalary(targetRow.player, leagueData);
    const targetOvr = playerOvr(targetRow.player);
    const buyers = buildFastMegaBuyers(leagueData, context, targetRow.teamName, directionMap).slice(0, maxBuyers);
    const sellerStandardCount = countStandardRosterPlayers(targetRow.team);
    const sellerMaxIncomingPlayers = Math.max(
      1,
      TRADE_TEMPORARY_STANDARD_ROSTER_MAX - Math.max(0, sellerStandardCount - 1)
    );
    for (const buyerRow of buyers) {
      const pickCacheKey = normalizeTeamName(buyerRow.teamName);
      if (!firstPickCache.has(pickCacheKey)) {
        firstPickCache.set(pickCacheKey, activeFirstPicksForTeam(leagueData, buyerRow.teamName, 4));
      }
      const firstPicks = firstPickCache.get(pickCacheKey) || [];
      if (firstPicks.length < 1) continue;
      const salaryCombos = buildBuyerSalaryCombos(leagueData, buyerRow.team, targetSalary);
      for (const salaryItems of salaryCombos) {
        if (salaryItems.length > sellerMaxIncomingPlayers) continue;
        const pickNeed = targetOvr >= 94 ? Math.min(4, Math.max(2, firstPicks.length)) : Math.min(3, Math.max(1, firstPicks.length));
        const picks = firstPicks.slice(0, pickNeed);
        const toItems = [...salaryItems, ...picks].slice(0, 7);
        if (toItems.length < 2) continue;
        out.push({
          id: `fast_mega_${hashString(`${targetRow.teamName}|${buyerRow.teamName}|${playerDisplayName(targetRow.player)}|${out.length}|${seed}`).toString(16)}`,
          fromTeamName: targetRow.teamName,
          toTeamName: buyerRow.teamName,
          fromItems: [playerTradeItem(targetRow.player, targetRow.teamName)],
          toItems,
          megaTrade: true,
          cpuMegaTrade: true,
          tradeType: "cpu_mega_trade",
          motive: `Mega Deadline Deal: ${targetRow.teamName} cashes out on ${playerDisplayName(targetRow.player)} while ${buyerRow.teamName} makes a title-window swing.`,
          debug: {
            megaTrade: true,
            fastMegaDeadlineRecipe: true,
            guaranteedMegaFallback: Boolean(targetRow.guaranteedMegaFallback),
            fallbackReason: targetRow.fallbackReason || "",
            targetPlayer: playerDisplayName(targetRow.player),
            targetOvr,
            targetAge: playerAge(targetRow.player),
            sellerWinPct: targetRow.winPct,
            sellerPowerRank: targetRow.powerRank,
          },
        });
        if (out.length >= maxCandidates) return out;
      }
    }
  }

  return out;
}


function selectDiversifiedMegaPlanCandidates(candidates = [], seed = "", limit = MEGA_TRADE_EXECUTION_FALLBACK_CHECKS) {
  const pool = shuffled(candidates, seed);
  const selected = [];
  const usedPairs = new Set();
  const usedBuyers = new Set();

  for (const candidate of pool) {
    if (selected.length >= limit) break;
    const seller = normalizeTeamName(candidate?.fromTeamName || "");
    const buyer = normalizeTeamName(candidate?.toTeamName || "");
    const pair = `${seller}|${buyer}`;
    if (!seller || !buyer || usedPairs.has(pair)) continue;
    if (usedBuyers.has(buyer) && selected.length < Math.min(3, limit)) continue;
    selected.push(candidate);
    usedPairs.add(pair);
    usedBuyers.add(buyer);
  }

  if (selected.length < limit) {
    for (const candidate of pool) {
      if (selected.length >= limit) break;
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
    }
  }

  return selected.slice(0, limit);
}

function withMegaPlannerState(leagueData = {}, state = {}) {
  return {
    ...leagueData,
    [CPU_TRADE_BANK_FIELD]: state,
  };
}

export function prepareCpuMegaTradePlan({
  leagueData,
  context = {},
  testConfig = {},
} = {}) {
  const startedAt = Date.now();
  const ensured = ensureCpuTradeBankState(leagueData, context, testConfig);
  if (!ensured.state) {
    return { leagueData, state: null, changed: false, planned: false, reason: "no_bank_state" };
  }

  const state = {
    ...ensured.state,
    candidates: [...ensured.state.candidates],
    stats: makeStats(ensured.state.stats),
  };
  const mega = normalizeMegaTradeState(state.megaTradeState, {
    seed: state.seed,
    seasonYear: state.seasonYear,
    deadlineDay: context?.deadlineDayIndex,
  });
  if (mega.status === "completed") {
    return { leagueData: ensured.leagueData, state, changed: ensured.changed, planned: false, reason: "mega_completed" };
  }

  const dayIndex = Math.max(0, Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)));
  const currentDate = context?.generatedDate || context?.currentDate || "";
  const attempts = Math.trunc(finiteNumber(mega.attempts, 0)) + 1;
  const candidates = buildFastMegaCandidates(ensured.leagueData, context, state, {
    maxTargets: MEGA_TRADE_FAST_MAX_TARGETS,
    maxBuyers: MEGA_TRADE_FAST_MAX_BUYERS,
    maxCandidates: MEGA_TRADE_PLAN_MAX_CANDIDATES,
  });
  const plannedCandidates = selectDiversifiedMegaPlanCandidates(
    candidates,
    `${state.seed}|mega-plan-selection:${attempts}:${dayIndex}`,
    MEGA_TRADE_EXECUTION_FALLBACK_CHECKS
  );

  if (!plannedCandidates.length) {
    state.megaTradeState = {
      ...mega,
      status: "pending",
      attempts,
      plannedCandidate: null,
      plannedCandidates: [],
      lastAttemptDayIndex: dayIndex,
      lastAttemptDate: currentDate,
      lastSkippedReason: "no_simple_legal_recipe_available",
      nextAttemptDayIndex: dayIndex + MEGA_TRADE_PLAN_RETRY_DAYS,
      diagnostics: {
        ...(mega.diagnostics || {}),
        planningPasses: finiteNumber(mega?.diagnostics?.planningPasses, 0) + 1,
        candidatesFound: 0,
        lastAction: "plan_failed",
        lastReason: "no_simple_legal_recipe_available",
      },
    };
    state.updatedAt = new Date().toISOString();
    state.stats.processingMs += Date.now() - startedAt;
    return {
      leagueData: withMegaPlannerState(ensured.leagueData, state),
      state,
      changed: true,
      planned: false,
      reason: "no_simple_legal_recipe_available",
    };
  }

  const plannedCandidate = plannedCandidates[0];
  const deadlineDay = Math.trunc(
    finiteNumber(context?.deadlineDayIndex, dayIndex + finiteNumber(context?.daysToDeadline, 30))
  );
  const executionDayIndex = Math.min(
    Math.max(dayIndex + 1, Math.trunc(finiteNumber(mega.executionDayIndex, dayIndex + 1))),
    Math.max(dayIndex + 1, deadlineDay - 1)
  );
  state.megaTradeState = {
    ...mega,
    status: "planned",
    attempts,
    executionDayIndex,
    targetDayIndex: executionDayIndex,
    nextAttemptDayIndex: executionDayIndex,
    plannedCandidate,
    plannedCandidates,
    plannedAtDayIndex: dayIndex,
    plannedAtDate: currentDate,
    lastAttemptDayIndex: dayIndex,
    lastAttemptDate: currentDate,
    lastSkippedReason: null,
    targetPlayerName: plannedCandidate?.debug?.targetPlayer || "",
    candidateBankId: plannedCandidate?.id || null,
    candidateSignature: getCpuTradeCandidateSignature(plannedCandidate),
    diagnostics: {
      ...(mega.diagnostics || {}),
      planningPasses: finiteNumber(mega?.diagnostics?.planningPasses, 0) + 1,
      candidatesFound: candidates.length,
      lastAction: "plan_ready",
      lastReason: null,
      plannedSeller: plannedCandidate?.fromTeamName || "",
      plannedBuyer: plannedCandidate?.toTeamName || "",
      plannedTarget: plannedCandidate?.debug?.targetPlayer || "",
      executionDayIndex,
    },
  };
  state.updatedAt = new Date().toISOString();
  state.stats.processingMs += Date.now() - startedAt;
  return {
    leagueData: withMegaPlannerState(ensured.leagueData, state),
    state,
    changed: true,
    planned: true,
    plannedCandidate,
    plannedCandidates,
    executionDayIndex,
    reason: "mega_plan_ready",
  };
}

function finalizePreparedMegaSuccess({
  baseLeagueData,
  state,
  mega,
  candidate,
  result,
  context,
  attempts,
  startedAt,
} = {}) {
  const patchedTradeRecord = {
    ...(result.tradeRecord || {}),
    cpuCpuTrade: true,
    cpuMegaTrade: true,
    megaTrade: true,
    tradeType: "cpu_mega_trade",
    megaDeadlineDeal: true,
    tradeLabel: "Mega Deadline Deal",
    motive: (result?.tradeRecord?.motive || candidate?.motive || "").startsWith("Mega Deadline Deal:")
      ? (result?.tradeRecord?.motive || candidate?.motive || "")
      : `Mega Deadline Deal: ${result?.tradeRecord?.motive || candidate?.motive || "A contender makes a title-window swing for a 90+ star."}`,
  };
  const finalLeagueWithRecord = replaceTradeRecordInLeague(result.leagueData, patchedTradeRecord);
  state.completedTrades = countCpuTradesForSeason(finalLeagueWithRecord, state.seasonYear);
  state.megaTradeState = {
    ...mega,
    status: "completed",
    attempts,
    plannedCandidate: null,
    plannedCandidates: [],
    executedTradeId: patchedTradeRecord?.id || patchedTradeRecord?.bankId || candidate?.id || null,
    executedDate: context?.currentDate || "",
    executedTeams: [candidate?.fromTeamName, candidate?.toTeamName].filter(Boolean),
    targetPlayerName: candidate?.debug?.targetPlayer || mega.targetPlayerName || "",
    candidateBankId: candidate?.bankId || candidate?.id || mega.candidateBankId || null,
    candidateSignature: candidate?.signature || getCpuTradeCandidateSignature(candidate),
    lastAttemptDayIndex: Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)),
    lastAttemptDate: context?.generatedDate || context?.currentDate || "",
    lastSkippedReason: null,
    nextAttemptDayIndex: null,
    diagnostics: {
      ...(mega.diagnostics || {}),
      executionChecks: finiteNumber(mega?.diagnostics?.executionChecks, 0) + 1,
      lastAction: "executed",
      lastReason: null,
      executedSeller: candidate?.fromTeamName || "",
      executedBuyer: candidate?.toTeamName || "",
      executedTarget: candidate?.debug?.targetPlayer || "",
    },
  };
  state.stats.megaTradesCompleted += 1;
  state.stats.lastExecution = {
    date: context?.currentDate || "",
    dayIndex: finiteNumber(context?.dayIndex, 0),
    result: "completed_prepared_mega_trade",
    candidateId: candidate?.bankId || candidate?.id,
    teams: [candidate?.fromTeamName, candidate?.toTeamName],
    bankSize: state.candidates.length,
  };
  state.stats.processingMs += Date.now() - startedAt;
  state.updatedAt = new Date().toISOString();
  return {
    ...result,
    leagueData: {
      ...finalLeagueWithRecord,
      [CPU_TRADE_BANK_FIELD]: state,
    },
    state,
    changed: true,
    executed: true,
    immediateMegaTrade: true,
    preparedMegaTrade: true,
    tradeRecord: patchedTradeRecord,
    reason: "completed_prepared_mega_trade",
  };
}

export function executePreparedCpuMegaTradePlan({
  leagueData,
  context = {},
  testConfig = {},
  maxCandidateChecks = MEGA_TRADE_EXECUTION_FALLBACK_CHECKS,
} = {}) {
  const startedAt = Date.now();
  let ensured = ensureCpuTradeBankState(leagueData, context, testConfig);
  if (!ensured.state) {
    return { leagueData, state: null, changed: false, executed: false, tradeRecord: null, reason: "no_bank_state" };
  }

  let state = {
    ...ensured.state,
    candidates: [...ensured.state.candidates],
    stats: makeStats(ensured.state.stats),
  };
  let mega = normalizeMegaTradeState(state.megaTradeState, {
    seed: state.seed,
    seasonYear: state.seasonYear,
    deadlineDay: context?.deadlineDayIndex,
  });
  if (mega.status === "completed") {
    return { leagueData: ensured.leagueData, state, changed: ensured.changed, executed: false, tradeRecord: null, reason: "mega_completed" };
  }

  // If a late save reaches the execution window without a plan, create one tiny
  // local plan first. This is still capped and never touches the normal evaluator.
  if (!mega.plannedCandidate && !mega.plannedCandidates?.length) {
    const planning = prepareCpuMegaTradePlan({ leagueData: ensured.leagueData, context, testConfig });
    ensured = { leagueData: planning.leagueData || ensured.leagueData, state: planning.state || state };
    state = {
      ...(planning.state || state),
      candidates: [...((planning.state || state).candidates || [])],
      stats: makeStats((planning.state || state).stats),
    };
    mega = normalizeMegaTradeState(state.megaTradeState, {
      seed: state.seed,
      seasonYear: state.seasonYear,
      deadlineDay: context?.deadlineDayIndex,
    });
  }

  const plannedPool = Array.isArray(mega.plannedCandidates) && mega.plannedCandidates.length
    ? mega.plannedCandidates
    : (mega.plannedCandidate ? [mega.plannedCandidate] : []);
  const checkLimit = clamp(
    Math.trunc(finiteNumber(maxCandidateChecks, MEGA_TRADE_EXECUTION_FALLBACK_CHECKS)),
    1,
    MEGA_TRADE_EXECUTION_FALLBACK_CHECKS
  );
  const attempts = Math.trunc(finiteNumber(mega.attempts, 0)) + 1;
  let lastFailure = null;
  let checks = 0;

  for (const candidate of plannedPool.slice(0, checkLimit)) {
    checks += 1;
    const result = executeCpuMegaTradeCandidateOnLeagueLoose({
      leagueData: ensured.leagueData,
      candidate,
      currentDate: context?.currentDate || "",
      tradeDeadlineDate: context?.tradeDeadlineDate || "",
      inOffseason: Boolean(context?.inOffseason),
      recordsByTeam: context?.recordsByTeam || null,
    });
    if (result?.ok && result?.leagueData) {
      return finalizePreparedMegaSuccess({
        baseLeagueData: ensured.leagueData,
        state,
        mega,
        candidate,
        result,
        context,
        attempts,
        startedAt,
      });
    }
    lastFailure = result;
  }

  const dayIndex = Math.max(0, Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)));
  const deadlineDay = Math.trunc(
    finiteNumber(context?.deadlineDayIndex, dayIndex + finiteNumber(context?.daysToDeadline, 3))
  );
  const retryDay = Math.min(Math.max(dayIndex + 1, dayIndex + MEGA_TRADE_EXECUTION_RETRY_DAYS), Math.max(dayIndex + 1, deadlineDay - 1));
  state.megaTradeState = {
    ...mega,
    status: "pending",
    attempts,
    plannedCandidate: null,
    plannedCandidates: [],
    executionDayIndex: retryDay,
    targetDayIndex: retryDay,
    nextAttemptDayIndex: Math.min(dayIndex + 1, retryDay),
    lastAttemptDayIndex: dayIndex,
    lastAttemptDate: context?.generatedDate || context?.currentDate || "",
    lastSkippedReason: lastFailure?.staleCode || lastFailure?.reason || "prepared_mega_package_became_illegal",
    diagnostics: {
      ...(mega.diagnostics || {}),
      executionChecks: finiteNumber(mega?.diagnostics?.executionChecks, 0) + checks,
      lastAction: "execution_retry_scheduled",
      lastReason: lastFailure?.staleCode || lastFailure?.reason || "prepared_mega_package_became_illegal",
      retryDay,
    },
  };
  state.updatedAt = new Date().toISOString();
  state.stats.processingMs += Date.now() - startedAt;
  return {
    leagueData: withMegaPlannerState(ensured.leagueData, state),
    state,
    changed: true,
    executed: false,
    tradeRecord: null,
    lastFailure,
    reason: state.megaTradeState.lastSkippedReason,
  };
}

export function executeImmediateCpuMegaTradeFromCandidates({
  leagueData,
  response,
  context = {},
  testConfig = {},
  maxCandidateChecks = MEGA_TRADE_DIRECT_SWEEP_CHECKS,
} = {}) {
  const startedAt = Date.now();
  const ensured = ensureCpuTradeBankState(leagueData, context, testConfig);
  if (!ensured.state) {
    return { leagueData, state: null, changed: false, executed: false, tradeRecord: null, reason: "no_bank_state" };
  }

  const state = {
    ...ensured.state,
    candidates: [...ensured.state.candidates],
    stats: makeStats(ensured.state.stats),
  };
  const userTeamName = getContextUserTeamName(context, ensured.leagueData);
  const workerCandidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const localCandidates = buildFastMegaCandidates(ensured.leagueData, context, state);
  const rawCandidates = localCandidates.length ? localCandidates : workerCandidates;
  const directCandidates = shuffled(
    rawCandidates.filter((candidate) => {
      if (!isMegaTradeCandidate(candidate) || candidateInvolvesTeam(candidate, userTeamName)) return false;
      const seller = getAllTeams(ensured.leagueData).find((team) => sameTeam(teamNameOf(team), candidate?.fromTeamName || candidate?.sellerTeamName || ""));
      const targetItem = Array.isArray(candidate?.fromItems) ? candidate.fromItems.find((item) => item?.type === "player") : null;
      const targetName = targetItem?.player?.name || targetItem?.playerName || candidate?.debug?.targetPlayer || "";
      const target = seller?.players?.find((player) => normalizeTeamName(playerDisplayName(player)) === normalizeTeamName(targetName)) || targetItem?.player || null;
      return seller ? !strictMegaSellerBlockReason(ensured.leagueData, context, seller, target) : false;
    }),
    `${state.seed}|direct-mega:${state?.megaTradeState?.attempts || 0}:${context?.currentDate || context?.dayIndex || ""}`
  ).map((candidate) => ({
    ...candidate,
    megaTrade: true,
    cpuMegaTrade: true,
    tradeType: "cpu_mega_trade",
    motive: String(candidate?.motive || "").startsWith("Mega Deadline Deal:")
      ? candidate.motive
      : `Mega Deadline Deal: ${candidate?.motive || "A contender makes a title-window swing for a 90+ star from a team outside the title race."}`,
    debug: {
      ...(candidate?.debug || {}),
      megaTrade: true,
      directMegaDeadlineSweep: true,
      fastRecipeCandidate: Boolean(localCandidates.length),
    },
  }));

  const mega = normalizeMegaTradeState(state.megaTradeState, {
    seed: state.seed,
    seasonYear: state.seasonYear,
    deadlineDay: context?.deadlineDayIndex,
  });
  const attempts = Math.trunc(finiteNumber(mega.attempts, 0)) + 1;

  if (!directCandidates.length) {
    state.megaTradeState = {
      ...mega,
      attempts,
      status: "failed_no_valid_package",
      lastAttemptDayIndex: Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)),
      lastAttemptDate: context?.generatedDate || context?.currentDate || "",
      lastSkippedReason: response?.skippedReason || "no_direct_mega_candidates",
      nextAttemptDayIndex: null,
    };
    state.updatedAt = new Date().toISOString();
    state.stats.processingMs += Date.now() - startedAt;
    return {
      leagueData: { ...ensured.leagueData, [CPU_TRADE_BANK_FIELD]: state },
      state,
      changed: true,
      executed: false,
      tradeRecord: null,
      reason: state.megaTradeState.lastSkippedReason,
    };
  }

  const candidates = rankCandidatesForExecution(directCandidates, state, {
    ...context,
    immediateMegaDeadlineSweep: true,
  });
  const checkLimit = clamp(Math.trunc(finiteNumber(maxCandidateChecks, MEGA_TRADE_DIRECT_SWEEP_CHECKS)), 1, MEGA_TRADE_FAST_MAX_CANDIDATES);
  let lastFailure = null;

  for (const candidate of candidates.slice(0, checkLimit)) {
    if (candidateInvolvesTeam(candidate, userTeamName)) {
      lastFailure = { ok: false, staleCode: "user_team_locked", reason: "Mega candidate involved controlled team." };
      continue;
    }

    const executionStartedAt = cpuTradeNow();
    const result = executeCpuMegaTradeCandidateOnLeagueLoose({
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
      phase: "direct_mega_deadline_sweep",
    });
    recordCpuTradeValidation({
      phase: "direct_mega_deadline_sweep",
      signature: candidate?.signature || getCpuTradeCandidateSignature(candidate),
      candidate,
      leagueData: ensured.leagueData,
      context,
      result,
      durationMs: executionMs,
    });

    if (!result?.ok || !result?.leagueData) {
      lastFailure = result;
      bumpReason(state.stats, result?.staleCode || "direct_mega_rejected");
      continue;
    }

    const patchedTradeRecord = {
      ...(result.tradeRecord || {}),
      cpuCpuTrade: true,
      cpuMegaTrade: true,
      megaTrade: true,
      tradeType: "cpu_mega_trade",
      megaDeadlineDeal: true,
      tradeLabel: "Mega Deadline Deal",
      motive: (result?.tradeRecord?.motive || candidate?.motive || "").startsWith("Mega Deadline Deal:")
        ? (result?.tradeRecord?.motive || candidate?.motive || "")
        : `Mega Deadline Deal: ${result?.tradeRecord?.motive || candidate?.motive || "A contender makes a title-window swing for a 90+ star."}`,
    };
    const finalLeagueWithRecord = replaceTradeRecordInLeague(result.leagueData, patchedTradeRecord);
    state.completedTrades = countCpuTradesForSeason(finalLeagueWithRecord, state.seasonYear);
    state.megaTradeState = {
      ...mega,
      attempts,
      status: "completed",
      executedTradeId: patchedTradeRecord?.id || patchedTradeRecord?.bankId || candidate?.id || null,
      executedDate: context?.currentDate || "",
      executedTeams: [candidate.fromTeamName, candidate.toTeamName].filter(Boolean),
      targetPlayerName: candidate?.debug?.targetPlayer || mega.targetPlayerName || "",
      candidateBankId: candidate?.bankId || candidate?.id || mega.candidateBankId || null,
      candidateSignature: candidate?.signature || getCpuTradeCandidateSignature(candidate),
      lastAttemptDayIndex: Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)),
      lastAttemptDate: context?.generatedDate || context?.currentDate || "",
      lastSkippedReason: null,
      nextAttemptDayIndex: null,
    };
    state.stats.megaTradesCompleted += 1;
    state.stats.lastExecution = {
      date: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      result: "completed_direct_mega_deadline_trade",
      candidateId: candidate.bankId || candidate.id,
      teams: [candidate.fromTeamName, candidate.toTeamName],
      bankSize: state.candidates.length,
    };
    state.stats.processingMs += Date.now() - startedAt;
    state.updatedAt = new Date().toISOString();
    return {
      ...result,
      leagueData: {
        ...finalLeagueWithRecord,
        [CPU_TRADE_BANK_FIELD]: state,
      },
      state,
      changed: true,
      executed: true,
      immediateMegaTrade: true,
      tradeRecord: patchedTradeRecord,
      reason: "completed_direct_mega_deadline_trade",
    };
  }

  state.megaTradeState = {
    ...mega,
    attempts,
    status: "failed_no_valid_package",
    lastAttemptDayIndex: Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)),
    lastAttemptDate: context?.generatedDate || context?.currentDate || "",
    lastSkippedReason: lastFailure?.staleCode || lastFailure?.reason || response?.skippedReason || "direct_mega_all_candidates_rejected",
    nextAttemptDayIndex: null,
  };
  state.updatedAt = new Date().toISOString();
  state.stats.processingMs += Date.now() - startedAt;
  return {
    leagueData: { ...ensured.leagueData, [CPU_TRADE_BANK_FIELD]: state },
    state,
    changed: true,
    executed: false,
    tradeRecord: null,
    lastFailure,
    reason: state.megaTradeState.lastSkippedReason,
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
  const megaGeneration = Boolean(context?.megaTradeMode || response?.debug?.megaTradeMode || candidates.some(isMegaTradeCandidate));
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
  if (megaGeneration) {
    state.stats.megaGenerationPasses += 1;
  } else {
    state.stats.generationPasses += 1;
  }
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
      (!isMegaTradeCandidate(candidate) && countBankEntriesForTeam(state.candidates, fromTeamName) >= MAX_BANK_ENTRIES_PER_TEAM) ||
      (!isMegaTradeCandidate(candidate) && countBankEntriesForTeam(state.candidates, toTeamName) >= MAX_BANK_ENTRIES_PER_TEAM)
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
      if (megaGeneration) state.stats.megaExactEvaluations += parallelPlan.length;
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
      !isMegaTradeCandidate(candidate) &&
      (countBankEntriesForTeam(state.candidates, fromTeamName) >= MAX_BANK_ENTRIES_PER_TEAM ||
        countBankEntriesForTeam(state.candidates, toTeamName) >= MAX_BANK_ENTRIES_PER_TEAM)
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
        if (megaGeneration) state.stats.megaExactEvaluations += 1;
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
    if (isMegaTradeCandidate(bankCandidate)) {
      state.stats.megaCandidatesAccepted += 1;
    }
    accepted.push(bankCandidate);

    if (megaGeneration && isMegaTradeCandidate(bankCandidate)) {
      break;
    }

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

  if (megaGeneration) {
    const mega = normalizeMegaTradeState(state.megaTradeState, {
      seed: state.seed,
      seasonYear: state.seasonYear,
      deadlineDay: context?.deadlineDayIndex,
    });
    const acceptedMega = accepted.find(isMegaTradeCandidate) || null;
    const attempts = Math.trunc(finiteNumber(mega.attempts, 0)) + 1;
    const skippedReason = response?.skippedReason || (acceptedMega ? null : "no_accepted_mega_candidate");
    state.megaTradeState = {
      ...mega,
      attempts,
      lastAttemptDayIndex: Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)),
      lastAttemptDate: context?.generatedDate || context?.currentDate || "",
      lastSkippedReason: skippedReason,
    };
    if (acceptedMega) {
      state.megaTradeState.status = "ready";
      state.megaTradeState.candidateBankId = acceptedMega.bankId || acceptedMega.id || null;
      state.megaTradeState.candidateSignature = acceptedMega.signature || null;
      state.megaTradeState.targetPlayerName = acceptedMega?.debug?.targetPlayer || "";
      state.megaTradeState.nextAttemptDayIndex = null;
    } else {
      const hardSweep = Boolean(context?.megaTradeHardSweep);
      state.megaTradeState.status = hardSweep ? "failed_no_valid_package" : "pending";
      state.megaTradeState.nextAttemptDayIndex = Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0)) + (hardSweep ? 3 : MEGA_TRADE_RETRY_COOLDOWN_DAYS);
    }
  }

  state.candidates = trimBank(state.candidates);
  if (!megaGeneration) {
    state.generationNonce += 1;
    state.lastGenerationDayIndex = Math.max(
      0,
      Math.trunc(finiteNumber(context?.generatedDayIndex ?? context?.dayIndex, 0))
    );
  }
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

function repairOrphanedReadyMegaState(state, context = {}, reason = "orphaned_ready_mega_candidate") {
  if (!state || String(state?.megaTradeState?.status || "") !== "ready") return false;
  if (Array.isArray(state?.candidates) && state.candidates.some(isMegaTradeCandidate)) return false;

  const mega = normalizeMegaTradeState(state.megaTradeState, {
    seed: state.seed,
    seasonYear: state.seasonYear,
    deadlineDay: context?.deadlineDayIndex,
  });
  state.megaTradeState = {
    ...mega,
    status: "pending",
    candidateBankId: null,
    candidateSignature: null,
    targetPlayerName: "",
    lastSkippedReason: reason,
    nextAttemptDayIndex: Math.max(0, Math.trunc(finiteNumber(context?.dayIndex, 0))),
  };
  return true;
}

function executionDue(state, context = {}, testConfig = {}) {
  if (!state || !isBeforeDeadline(context)) return false;
  if (testConfig?.forceExecution) return true;

  const dayIndex = finiteNumber(context?.dayIndex, 0);
  const hasReadyMegaTrade =
    String(state?.megaTradeState?.status || "") === "ready" &&
    (state.candidates || []).some(isMegaTradeCandidate);
  if (hasReadyMegaTrade) return true;

  if (finiteNumber(state.completedTrades, 0) >= finiteNumber(state.targetTrades, 30)) return false;
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
  if (behindPace && bankHasInventory && daysToDeadline <= 82) return true;
  if (bankHasInventory && daysToDeadline <= 28 && completedTrades < minimumTrades) return true;
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
    repairOrphanedReadyMegaState(state, context, "ready_mega_missing_from_empty_bank");
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

    const executedMegaTrade = isMegaTradeCandidate(candidate) || isMegaTradeCandidate(result?.tradeRecord);
    state.completedTrades = countCpuTradesForSeason(result.leagueData, state.seasonYear);
    if (executedMegaTrade) {
      const mega = normalizeMegaTradeState(state.megaTradeState, {
        seed: state.seed,
        seasonYear: state.seasonYear,
        deadlineDay: context?.deadlineDayIndex,
      });
      state.megaTradeState = {
        ...mega,
        status: "completed",
        executedTradeId: result?.tradeRecord?.id || result?.tradeRecord?.bankId || candidate?.bankId || candidate?.id || null,
        executedDate: context?.currentDate || "",
        executedTeams: [candidate.fromTeamName, candidate.toTeamName].filter(Boolean),
        targetPlayerName: candidate?.debug?.targetPlayer || mega.targetPlayerName || "",
        candidateBankId: candidate?.bankId || candidate?.id || mega.candidateBankId || null,
        candidateSignature: candidate?.signature || mega.candidateSignature || null,
      };
      state.stats.megaTradesCompleted += 1;
    } else {
      state.planCursor = Math.min(
        state.executionPlanDays.length,
        Math.max(finiteNumber(state.planCursor, 0) + 1, state.completedTrades)
      );
    }
    state.selectionNonce += 1;
    state.candidates = removeCandidatesInvolvingTeams(state.candidates, [
      candidate.fromTeamName,
      candidate.toTeamName,
    ]);
    state.stats.completedTrades = state.completedTrades;
    state.stats.lastExecution = {
      date: context?.currentDate || "",
      dayIndex: finiteNumber(context?.dayIndex, 0),
      result: executedMegaTrade ? "completed_mega_trade" : "completed",
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
  repairOrphanedReadyMegaState(state, context, lastFailure?.staleCode || "ready_mega_candidate_became_stale");
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
    megaTradeState: state.megaTradeState || null,
    packageTypes,
    rejectionReasons: { ...stats.rejectionReasons },
    stats,
  };
}
