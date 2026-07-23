import {
  executeCpuTradeCandidateOnLeague,
  validateCpuTradeCandidateOnLeague,
} from "./tradeExecution.js";
import { normalizeTeamName } from "./draftPicks.js";

export const CPU_TRADE_BANK_FIELD = "cpuTradeBankState";
export const CPU_TRADE_BANK_VERSION = 1;
export const CPU_TRADE_BANK_TEST_CONFIG_KEY = "bm_cpu_trade_bank_test_config_v1";

const TARGET_MIN = 20;
const TARGET_MAX = 40;
const MAX_BANK_SIZE = 90;
const MAX_BANK_ENTRIES_PER_TEAM = 14;
const FIRST_EXECUTION_DAY = 12;

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
  const days = [];

  for (let day = start; day <= end; day += 1) {
    const progress = (day - start) / Math.max(1, end - start);
    const weight = 0.12 + Math.pow(progress, 2.35) * 4.6;
    days.push({ day, weight });
  }

  const random = seededRandom(`${seed}|execution-plan`);
  const selected = [];
  const pool = [...days];
  const desired = Math.min(Math.max(0, targetTrades), pool.length);

  while (selected.length < desired && pool.length) {
    const totalWeight = pool.reduce((sum, row) => sum + row.weight, 0);
    let roll = random() * totalWeight;
    let selectedIndex = pool.length - 1;

    for (let index = 0; index < pool.length; index += 1) {
      roll -= pool[index].weight;
      if (roll <= 0) {
        selectedIndex = index;
        break;
      }
    }

    selected.push(pool[selectedIndex].day);
    pool.splice(selectedIndex, 1);
  }

  return selected.sort((a, b) => a - b);
}

function createBankState(leagueData, context, testConfig = {}) {
  const seasonYear = getSeasonYear(leagueData, context);
  const seed = randomSeedToken(seasonYear, testConfig?.seed || "");
  const random = seededRandom(`${seed}|target`);
  const baseTargetTrades = TARGET_MIN + Math.floor(random() * (TARGET_MAX - TARGET_MIN + 1));
  const targetOverride = finiteNumber(testConfig?.targetTrades, 0);
  const targetTrades = targetOverride > 0
    ? clamp(Math.trunc(targetOverride), 1, 60)
    : baseTargetTrades;
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
    completedTrades,
    candidates: [],
    generationNonce: 0,
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
  const baseTargetTrades = clamp(
    Math.trunc(
      finiteNumber(
        state.baseTargetTrades,
        TARGET_MIN + Math.floor(random() * (TARGET_MAX - TARGET_MIN + 1))
      )
    ),
    TARGET_MIN,
    TARGET_MAX
  );
  state.baseTargetTrades = baseTargetTrades;
  const targetOverride = finiteNumber(testConfig?.targetTrades, 0);
  const desiredTargetTrades = targetOverride > 0
    ? clamp(Math.trunc(targetOverride), 1, 60)
    : baseTargetTrades;
  if (state.targetTrades !== desiredTargetTrades) {
    state.targetTrades = desiredTargetTrades;
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

function trimBank(candidates = []) {
  if (candidates.length <= MAX_BANK_SIZE) return candidates;
  return [...candidates]
    .sort((a, b) => {
      const aScore = finiteNumber(a?.priority, 0);
      const bScore = finiteNumber(b?.priority, 0);
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

export function getCpuTradeBankGenerationPolicy(state, context = {}, testConfig = {}) {
  if (!state || !isBeforeDeadline(context)) {
    return { shouldGenerate: false, reason: "timing_locked", maxCandidates: 0, exactEvaluations: 0 };
  }

  const dayIndex = Math.max(0, Math.trunc(finiteNumber(context?.dayIndex, 0)));
  const totalDates = Math.max(1, Math.trunc(finiteNumber(context?.totalDates, 170)));
  const daysToDeadline = finiteNumber(context?.daysToDeadline, 999);
  const deadlineDayIndex = Math.max(
    dayIndex + 1,
    Math.trunc(
      finiteNumber(
        context?.deadlineDayIndex,
        dayIndex + Math.max(1, daysToDeadline)
      )
    )
  );
  const progress = clamp(dayIndex / totalDates, 0, 1);
  const deadlineProgress = clamp(dayIndex / Math.max(1, deadlineDayIndex), 0, 1);
  const completedTrades = finiteNumber(state.completedTrades, 0);
  const remainingTarget = Math.max(
    0,
    finiteNumber(state.targetTrades, 30) - completedTrades
  );
  const desiredReserve = clamp(remainingTarget + 8, 14, MAX_BANK_SIZE);
  const bankSize = state.candidates.length;

  // Execution is intentionally late-weighted. Increase background work only
  // when accepted inventory is thin or the save is behind that same pace.
  const expectedCompletedByNow = Math.floor(
    finiteNumber(state.targetTrades, 30) * Math.pow(deadlineProgress, 2.05)
  );
  const completionDeficit = Math.max(
    0,
    expectedCompletedByNow - completedTrades
  );
  const reserveDeficit = Math.max(
    0,
    Math.min(desiredReserve, remainingTarget + 5) - bankSize
  );
  const supplyUrgent =
    bankSize < Math.min(6, Math.max(2, remainingTarget));
  const supplySatisfied =
    bankSize >= Math.min(desiredReserve, remainingTarget + 3);

  let cadence = progress < 0.30 ? 4 : progress < 0.67 ? 3 : 2;
  if (
    supplyUrgent ||
    completionDeficit >= 2 ||
    (progress >= 0.30 && reserveDeficit >= 10)
  ) {
    cadence = Math.min(cadence, 2);
  }
  if (daysToDeadline <= 42 && remainingTarget > bankSize) {
    cadence = 1;
  }
  if (supplySatisfied) {
    cadence = Math.max(cadence, daysToDeadline <= 14 ? 3 : 6);
  }

  const offset =
    hashString(`${state.seed}|generation-offset`) % Math.max(1, cadence);
  const forced = Boolean(testConfig?.forceGeneration);
  const shouldGenerate = forced || dayIndex % cadence === offset;

  let defaultCandidates =
    daysToDeadline <= 14
      ? 12
      : daysToDeadline <= 35
        ? 10
        : progress >= 0.67
          ? 8
          : 4;
  let defaultExact =
    daysToDeadline <= 14
      ? 10
      : daysToDeadline <= 35
        ? 8
        : progress >= 0.67
          ? 6
          : 3;

  if (supplyUrgent || completionDeficit > 0) {
    defaultCandidates = Math.max(
      defaultCandidates,
      daysToDeadline <= 42 ? 12 : 8
    );
    defaultExact = Math.max(
      defaultExact,
      daysToDeadline <= 42 ? 10 : 6
    );
  } else if (supplySatisfied) {
    defaultCandidates = Math.min(defaultCandidates, 4);
    defaultExact = Math.min(defaultExact, 3);
  }

  return {
    shouldGenerate,
    reason: shouldGenerate ? (forced ? "forced" : "cadence") : "cadence_wait",
    cadence,
    offset,
    desiredReserve,
    expectedCompletedByNow,
    completionDeficit,
    reserveDeficit,
    supplyUrgent,
    supplySatisfied,
    maxCandidates: clamp(
      Math.trunc(finiteNumber(testConfig?.generationCandidates, defaultCandidates)),
      1,
      12
    ),
    exactEvaluations: clamp(
      Math.trunc(finiteNumber(testConfig?.exactEvaluations, defaultExact)),
      1,
      12
    ),
  };
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
  };
}

export function addGeneratedCpuTradeCandidates({
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
  const limit = clamp(Math.trunc(finiteNumber(exactEvaluationLimit, 3)), 1, 8);

  const exactEvaluationsBefore = state.stats.exactEvaluations;
  const duplicatesBefore = state.stats.duplicateCandidates;
  const rejectionsBefore = state.stats.rejectedCandidates;
  state.stats.generationPasses += 1;
  state.stats.proposedCandidates += candidates.length;

  for (const candidate of candidates.slice(0, limit)) {
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

    state.stats.exactEvaluations += 1;
    const validation = validateCpuTradeCandidateOnLeague({
      leagueData: ensured.leagueData,
      candidate,
      currentDate: context?.currentDate || "",
      tradeDeadlineDate: context?.tradeDeadlineDate || "",
      inOffseason: Boolean(context?.inOffseason),
    });

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
  }

  state.candidates = trimBank(state.candidates);
  state.generationNonce += 1;
  state.updatedAt = new Date().toISOString();
  state.stats.processingMs += Date.now() - startedAt;
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

  const cursor = Math.max(0, Math.trunc(finiteNumber(state.planCursor, 0)));
  const plannedDay = state.executionPlanDays?.[cursor];
  if (!Number.isFinite(Number(plannedDay))) return false;
  return finiteNumber(context?.dayIndex, 0) >= Number(plannedDay);
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
  const candidates = shuffled(
    state.candidates,
    `${state.seed}|selection:${state.selectionNonce}|${context?.currentDate || context?.dayIndex || ""}`
  );
  const checkLimit = clamp(Math.trunc(finiteNumber(maxCandidateChecks, 4)), 1, 10);

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
      const validation = validateCpuTradeCandidateOnLeague({
        leagueData: ensured.leagueData,
        candidate,
        currentDate: context?.currentDate || "",
        tradeDeadlineDate: context?.tradeDeadlineDate || "",
        inOffseason: Boolean(context?.inOffseason),
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

    const result = executeCpuTradeCandidateOnLeague({
      leagueData: ensured.leagueData,
      candidate,
      currentDate: context?.currentDate || "",
      tradeDeadlineDate: context?.tradeDeadlineDate || "",
      inOffseason: Boolean(context?.inOffseason),
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
  const checks = clamp(Math.trunc(finiteNumber(maxChecks, 1)), 1, 4);
  let checked = 0;
  let removed = 0;
  let cursor = Math.max(0, Math.trunc(finiteNumber(state.pruneCursor, 0)));
  const userTeamName = getContextUserTeamName(context, ensured.leagueData);

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
    const validation = validateCpuTradeCandidateOnLeague({
      leagueData: ensured.leagueData,
      candidate,
      currentDate: context?.currentDate || "",
      tradeDeadlineDate: context?.tradeDeadlineDate || "",
      inOffseason: Boolean(context?.inOffseason),
    });

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
  state.stats.processingMs += Date.now() - startedAt;

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
    completedTrades: state.completedTrades,
    remainingTarget: Math.max(0, state.targetTrades - state.completedTrades),
    bankSize: state.candidates.length,
    nextPlannedDay: state.executionPlanDays?.[state.planCursor] ?? null,
    generationNonce: state.generationNonce,
    packageTypes,
    rejectionReasons: { ...stats.rejectionReasons },
    stats,
  };
}
