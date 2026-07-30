import { getCpuCpuTradeCandidates, getCpuTradeGenerationPoolStatus, prewarmCpuTradeWorker } from "../api/cpuTradeEngine.js";
import { repairCpuTeamsToMinRoster } from "../api/simEnginePy.js";
import { runCpuTradePackageBenchmarks } from "./cpuTradeDiagnostics.js";
import { getCpuTradeCandidateSignature } from "./cpuTradeBank.js";
import { validateCpuTradeCandidateOnLeague } from "./tradeExecution.js";
import { getCpuTradeImpactCacheStats, resetCpuTradeImpactCache } from "./tradeTeamImpact.js";
import {
  configureCpuTradeTrace,
  getCpuTradeTraceConfig,
} from "./cpuTradeTelemetry.js";

const MICROPROFILE_VERSION = "2026-07-29_v1";
const VALIDATION_MICROPROFILE_VERSION = "2026-07-29_v3";
const STORAGE_DB_PREFIX = "BM_SIM_SPEED_MICROPROFILE_V1";

function nowMs() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value) {
  return Math.round(finiteNumber(value, 0) * 1000) / 1000;
}

function percentile(values = [], p = 0.5) {
  const rows = values.map((value) => finiteNumber(value, 0)).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const index = Math.min(rows.length - 1, Math.max(0, Math.ceil(rows.length * p) - 1));
  return round3(rows[index]);
}

function summarizeDurations(values = []) {
  const rows = values.map((value) => finiteNumber(value, 0));
  return {
    count: rows.length,
    totalMs: round3(rows.reduce((sum, value) => sum + value, 0)),
    averageMs: rows.length ? round3(rows.reduce((sum, value) => sum + value, 0) / rows.length) : 0,
    medianMs: percentile(rows, 0.5),
    p95Ms: percentile(rows, 0.95),
    minMs: rows.length ? round3(Math.min(...rows)) : 0,
    maxMs: rows.length ? round3(Math.max(...rows)) : 0,
  };
}

function getAllTeams(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.filter(Boolean);
  const conferences = leagueData?.conferences;
  if (!conferences || typeof conferences !== "object") return [];
  return Object.values(conferences).flatMap((teams) => Array.isArray(teams) ? teams.filter(Boolean) : []);
}

function teamNameOf(team = {}) {
  return team?.name || team?.teamName || team?.team || "";
}

function playerKey(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.personId ?? player?.nbaId;
  if (id !== null && id !== undefined && String(id).trim()) return `id:${String(id)}`;
  const name = String(player?.name || player?.player || player?.fullName || "").trim().toLowerCase();
  return `name:${name}`;
}

function inferSelectedTeamName(selectedTeam, leagueData = {}) {
  const candidates = [
    selectedTeam,
    selectedTeam?.name,
    selectedTeam?.teamName,
    selectedTeam?.team,
    leagueData?.selectedTeam,
    leagueData?.selectedTeamName,
    leagueData?.userTeam,
    leagueData?.userTeamName,
    leagueData?.controlledTeam,
    leagueData?.controlledTeamName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const name = candidate?.name || candidate?.teamName || candidate?.team;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return "";
}

function inferSeasonYear(leagueData = {}) {
  return Math.trunc(finiteNumber(
    leagueData?.currentSeasonYear ?? leagueData?.seasonYear ?? leagueData?.year,
    new Date().getFullYear()
  ));
}

function inferCurrentDate(leagueData = {}) {
  const direct = [
    leagueData?.currentDate,
    leagueData?.simulationDate,
    leagueData?.calendarDate,
    leagueData?.date,
  ].find((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (direct) return direct;

  const schedules = [leagueData?.schedule, leagueData?.regularSeasonSchedule, leagueData?.games];
  for (const schedule of schedules) {
    if (!Array.isArray(schedule)) continue;
    const pending = schedule.find((game) => {
      if (!game || typeof game !== "object") return false;
      const played = game?.played ?? game?.completed ?? game?.isComplete ?? game?.simulated;
      return !played && typeof game?.date === "string";
    });
    if (pending?.date) return pending.date;
    const first = schedule.find((game) => typeof game?.date === "string");
    if (first?.date) return first.date;
  }

  return `${inferSeasonYear(leagueData)}-10-20`;
}

function inferTradeDeadlineDate(leagueData = {}, currentDate = "") {
  const direct = [
    leagueData?.tradeDeadlineDate,
    leagueData?.settings?.tradeDeadlineDate,
    leagueData?.calendar?.tradeDeadlineDate,
  ].find((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (direct) return direct;
  const currentYear = Number(String(currentDate || "").slice(0, 4));
  const year = Number.isFinite(currentYear) ? currentYear + 1 : inferSeasonYear(leagueData) + 1;
  return `${year}-02-05`;
}

function dayDifference(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 999;
  return Math.ceil((to.getTime() - from.getTime()) / 86400000);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonSizeAndClone(value) {
  const startedAt = nowMs();
  const json = JSON.stringify(value);
  const serializationMs = nowMs() - startedAt;
  const parseStartedAt = nowMs();
  const clone = JSON.parse(json);
  const parseMs = nowMs() - parseStartedAt;
  return {
    clone,
    bytes: json.length,
    serializationMs: round3(serializationMs),
    parseMs: round3(parseMs),
  };
}

function hashText(text = "") {
  let hash = 2166136261;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function rosterAndRatingSnapshot(leagueData = {}) {
  const rows = [];
  for (const team of getAllTeams(leagueData)) {
    const teamName = teamNameOf(team);
    for (const player of team?.players || []) {
      rows.push({
        owner: teamName,
        key: playerKey(player),
        overall: player?.overall ?? player?.ovr ?? null,
        potential: player?.potential ?? player?.pot ?? null,
        offRating: player?.offRating ?? null,
        defRating: player?.defRating ?? null,
        rosterStatus: player?.rosterStatus ?? player?.contractType ?? null,
      });
    }
    for (const player of team?.twoWayPlayers || []) {
      rows.push({
        owner: `${teamName}:two-way`,
        key: playerKey(player),
        overall: player?.overall ?? player?.ovr ?? null,
        potential: player?.potential ?? player?.pot ?? null,
        offRating: player?.offRating ?? null,
        defRating: player?.defRating ?? null,
        rosterStatus: player?.rosterStatus ?? player?.contractType ?? "two-way",
      });
    }
  }
  for (const player of leagueData?.freeAgents || []) {
    rows.push({
      owner: "FREE_AGENT",
      key: playerKey(player),
      overall: player?.overall ?? player?.ovr ?? null,
      potential: player?.potential ?? player?.pot ?? null,
      offRating: player?.offRating ?? null,
      defRating: player?.defRating ?? null,
      rosterStatus: player?.rosterStatus ?? player?.contractType ?? null,
    });
  }
  rows.sort((a, b) => `${a.key}|${a.owner}`.localeCompare(`${b.key}|${b.owner}`));
  return rows;
}

function compareRepairSnapshots(beforeRows = [], afterRows = []) {
  const before = new Map(beforeRows.map((row) => [row.key, row]));
  const after = new Map(afterRows.map((row) => [row.key, row]));
  let ownerChanges = 0;
  let ratingChanges = 0;
  let missingAfter = 0;
  let newAfter = 0;
  const changedOwners = [];
  const changedRatings = [];

  for (const [key, prior] of before.entries()) {
    const next = after.get(key);
    if (!next) {
      missingAfter += 1;
      continue;
    }
    if (prior.owner !== next.owner) {
      ownerChanges += 1;
      if (changedOwners.length < 30) changedOwners.push({ key, before: prior.owner, after: next.owner });
    }
    const priorRatings = [prior.overall, prior.potential, prior.offRating, prior.defRating];
    const nextRatings = [next.overall, next.potential, next.offRating, next.defRating];
    if (JSON.stringify(priorRatings) !== JSON.stringify(nextRatings)) {
      ratingChanges += 1;
      if (changedRatings.length < 30) changedRatings.push({ key, before: priorRatings, after: nextRatings });
    }
  }
  for (const key of after.keys()) {
    if (!before.has(key)) newAfter += 1;
  }

  return {
    ownerChanges,
    ratingChanges,
    missingAfter,
    newAfter,
    changedOwners,
    changedRatings,
  };
}

function makeGeneratorContext(leagueData = {}, selectedTeam = null, maxCandidates = 42) {
  const currentDate = inferCurrentDate(leagueData);
  const tradeDeadlineDate = inferTradeDeadlineDate(leagueData, currentDate);
  const state = leagueData?.cpuTradeBankState || {};
  return {
    currentDate,
    dayIndex: 40,
    totalDates: 170,
    tradeDeadlineDate,
    daysToDeadline: dayDifference(currentDate, tradeDeadlineDate),
    userTeamName: inferSelectedTeamName(selectedTeam, leagueData),
    recordsByTeam: {},
    maxCandidates,
    bankGenerationMode: true,
    bankSeed: state?.seed || `microprofile-${inferSeasonYear(leagueData)}`,
    generationNonce: 910001,
    forceCpuTradeActivity: true,
    remainingTarget: Math.max(1, finiteNumber(state?.targetTrades, 30) - finiteNumber(state?.completedTrades, 0)),
    bankSize: Array.isArray(state?.candidates) ? state.candidates.length : 0,
    inventoryPressure: 1.25,
    foregroundRecommended: true,
    generationReason: "sim_speed_microprofile",
  };
}

async function runGeneratorProfile(leagueData = {}, selectedTeam = null) {
  const previousTraceConfig = getCpuTradeTraceConfig();
  configureCpuTradeTrace({ enabled: true, noCpuTrades: false, label: "sim_speed_microprofile" });
  prewarmCpuTradeWorker();

  try {
    const rows = [];
    for (const maxCandidates of [1, 42, 84, 120]) {
      const context = makeGeneratorContext(leagueData, selectedTeam, maxCandidates);
      const startedAt = nowMs();
      const response = await getCpuCpuTradeCandidates(leagueData, context);
      const wallMs = nowMs() - startedAt;
      const timing = response?.debug?.workerTiming || null;
      rows.push({
        phase: maxCandidates === 1 ? "warmup" : "measured",
        maxCandidates,
        wallMs: round3(wallMs),
        returnedCandidates: Array.isArray(response?.candidates) ? response.candidates.length : 0,
        tradeDeskItems: Array.isArray(response?.tradeDeskItems) ? response.tradeDeskItems.length : 0,
        workerTiming: timing ? {
          readyWaitMs: round3(timing.readyWaitMs),
          pyodideInitializationMs: round3(timing.pyodideInitializationMs),
          reusedWarmRuntime: Boolean(timing.reusedWarmRuntime),
          inputSerializationMs: round3(timing.inputSerializationMs),
          pythonExecutionMs: round3(timing.pythonExecutionMs),
          resultParseMs: round3(timing.resultParseMs),
          responsePreparationMs: round3(timing.responsePreparationMs),
          inputBytes: finiteNumber(timing.inputBytes, 0),
          resultBytes: finiteNumber(timing.resultBytes, 0),
        } : null,
      });
    }
    return {
      ok: true,
      pool: getCpuTradeGenerationPoolStatus(),
      rows,
    };
  } finally {
    configureCpuTradeTrace(previousTraceConfig);
  }
}

function openBenchmarkDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("bench")) db.createObjectStore("bench");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("microprofile_indexeddb_open_failed"));
  });
}

function putBenchmarkValue(db, key, value) {
  return new Promise((resolve, reject) => {
    const startedAt = nowMs();
    const tx = db.transaction("bench", "readwrite");
    const store = tx.objectStore("bench");
    store.put(value, key);
    tx.oncomplete = () => resolve(round3(nowMs() - startedAt));
    tx.onerror = () => reject(tx.error || new Error("microprofile_indexeddb_write_failed"));
    tx.onabort = () => reject(tx.error || new Error("microprofile_indexeddb_write_aborted"));
  });
}

function deleteBenchmarkDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

async function runStorageProfile(leagueData = {}) {
  if (typeof indexedDB === "undefined") {
    return { ok: false, skipped: true, reason: "indexeddb_unavailable" };
  }

  const fullFixture = jsonSizeAndClone(leagueData);
  const bankPayload = {
    seasonYear: leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? null,
    currentDate: inferCurrentDate(leagueData),
    cpuTradeBankState: leagueData?.cpuTradeBankState || null,
  };
  const bankFixture = jsonSizeAndClone(bankPayload);
  const dbName = `${STORAGE_DB_PREFIX}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let db = null;

  try {
    db = await openBenchmarkDatabase(dbName);
    const fullWrites = [];
    const bankWrites = [];
    for (let index = 0; index < 3; index += 1) {
      fullWrites.push(await putBenchmarkValue(db, `full-${index}`, fullFixture.clone));
    }
    for (let index = 0; index < 5; index += 1) {
      bankWrites.push(await putBenchmarkValue(db, `bank-${index}`, bankFixture.clone));
    }
    return {
      ok: true,
      isolatedDatabase: true,
      fullLeague: {
        bytes: fullFixture.bytes,
        serializationMs: fullFixture.serializationMs,
        parseMs: fullFixture.parseMs,
        writes: summarizeDurations(fullWrites),
      },
      bankOnly: {
        bytes: bankFixture.bytes,
        serializationMs: bankFixture.serializationMs,
        parseMs: bankFixture.parseMs,
        writes: summarizeDurations(bankWrites),
      },
      sizeReductionPct: fullFixture.bytes > 0
        ? round3((1 - bankFixture.bytes / fullFixture.bytes) * 100)
        : 0,
      medianWriteReductionPct: summarizeDurations(fullWrites).medianMs > 0
        ? round3((1 - summarizeDurations(bankWrites).medianMs / summarizeDurations(fullWrites).medianMs) * 100)
        : 0,
    };
  } finally {
    try { db?.close(); } catch {}
    await deleteBenchmarkDatabase(dbName);
  }
}

async function runRepairProfile(leagueData = {}, selectedTeam = null) {
  const userTeamName = inferSelectedTeamName(selectedTeam, leagueData);
  const fixtureOne = cloneJson(leagueData);
  const fixtureTwo = cloneJson(leagueData);
  const beforeRows = rosterAndRatingSnapshot(fixtureOne);
  const currentDay = finiteNumber(leagueData?.freeAgencyState?.currentDay ?? leagueData?.currentDay, 0);

  const coldStartedAt = nowMs();
  const coldResult = await repairCpuTeamsToMinRoster(fixtureOne, userTeamName, 14, currentDay);
  const coldMs = nowMs() - coldStartedAt;

  const warmStartedAt = nowMs();
  const warmResult = await repairCpuTeamsToMinRoster(fixtureTwo, userTeamName, 14, currentDay);
  const warmMs = nowMs() - warmStartedAt;

  const coldLeague = coldResult?.leagueData || {};
  const warmLeague = warmResult?.leagueData || {};
  const coldRows = rosterAndRatingSnapshot(coldLeague);
  const warmRows = rosterAndRatingSnapshot(warmLeague);
  const coldComparison = compareRepairSnapshots(beforeRows, coldRows);
  const warmComparison = compareRepairSnapshots(beforeRows, warmRows);
  const coldSummary = {
    ok: Boolean(coldResult?.ok),
    signings: Array.isArray(coldResult?.signings) ? coldResult.signings.length : 0,
    highValueSignings: Array.isArray(coldResult?.highValueSignings) ? coldResult.highValueSignings.length : 0,
    cleanupSignings: Array.isArray(coldResult?.cleanupSignings) ? coldResult.cleanupSignings.length : 0,
    droppedPlayers: Array.isArray(coldResult?.droppedPlayers) ? coldResult.droppedPlayers.length : 0,
    twoWayAssignments: Array.isArray(coldResult?.twoWayAssignments) ? coldResult.twoWayAssignments.length : 0,
    failedTeams: Array.isArray(coldResult?.failedTeams) ? coldResult.failedTeams.length : 0,
    overMaxTeams: Array.isArray(coldResult?.overMaxTeams) ? coldResult.overMaxTeams.length : 0,
    ratingFreezeRestoredFields: finiteNumber(coldResult?.ratingFreezeAudit?.restoredFields, 0),
  };
  const warmSummary = {
    ok: Boolean(warmResult?.ok),
    signings: Array.isArray(warmResult?.signings) ? warmResult.signings.length : 0,
    highValueSignings: Array.isArray(warmResult?.highValueSignings) ? warmResult.highValueSignings.length : 0,
    cleanupSignings: Array.isArray(warmResult?.cleanupSignings) ? warmResult.cleanupSignings.length : 0,
    droppedPlayers: Array.isArray(warmResult?.droppedPlayers) ? warmResult.droppedPlayers.length : 0,
    twoWayAssignments: Array.isArray(warmResult?.twoWayAssignments) ? warmResult.twoWayAssignments.length : 0,
    failedTeams: Array.isArray(warmResult?.failedTeams) ? warmResult.failedTeams.length : 0,
    overMaxTeams: Array.isArray(warmResult?.overMaxTeams) ? warmResult.overMaxTeams.length : 0,
    ratingFreezeRestoredFields: finiteNumber(warmResult?.ratingFreezeAudit?.restoredFields, 0),
  };

  return {
    ok: Boolean(coldResult?.ok && warmResult?.ok),
    coldMs: round3(coldMs),
    warmMs: round3(warmMs),
    deterministicOutput: hashText(JSON.stringify(coldRows)) === hashText(JSON.stringify(warmRows)),
    coldOutputHash: hashText(JSON.stringify(coldRows)),
    warmOutputHash: hashText(JSON.stringify(warmRows)),
    coldSummary,
    warmSummary,
    coldComparison,
    warmComparison,
  };
}


function teamViewAccepted(view = {}) {
  if (typeof view?.accepted === "boolean") return view.accepted;
  return String(view?.decision || "").toLowerCase() === "accept";
}

function validationResultSummary(result = {}) {
  const thresholdOf = (view) => finiteNumber(view?.teamImpact?.threshold ?? view?.threshold, 0);
  return {
    ok: Boolean(result?.ok),
    staleCode: result?.staleCode || null,
    reason: result?.reason || result?.message || "",
    requiresRosterRepairBeforeSimulation: Boolean(result?.requiresRosterRepairBeforeSimulation),
    buyerAccepted: teamViewAccepted(result?.toTeamView || {}),
    sellerAccepted: teamViewAccepted(result?.fromTeamView || {}),
    buyerScore: round3(result?.toTeamView?.score || 0),
    buyerThreshold: round3(thresholdOf(result?.toTeamView || {})),
    sellerScore: round3(result?.fromTeamView?.score || 0),
    sellerThreshold: round3(thresholdOf(result?.fromTeamView || {})),
    executionLegal: Boolean(result?.executionValidation?.ok),
  };
}

function candidatePackageShape(candidate = {}) {
  const fromItems = Array.isArray(candidate?.fromItems) ? candidate.fromItems : [];
  const toItems = Array.isArray(candidate?.toItems) ? candidate.toItems : [];
  const isPick = (item) => String(item?.type || item?.assetType || "").toLowerCase().includes("pick") || Boolean(item?.pickId || item?.draftPickId);
  const fromPlayers = fromItems.filter((item) => !isPick(item)).length;
  const toPlayers = toItems.filter((item) => !isPick(item)).length;
  const picks = fromItems.filter(isPick).length + toItems.filter(isPick).length;
  return {
    fromPlayers,
    toPlayers,
    picks,
    assets: fromItems.length + toItems.length,
    shape: `${fromPlayers}v${toPlayers}${picks ? `+${picks}pick${picks === 1 ? "" : "s"}` : ""}`,
  };
}

function validationOutcomeCounts(rows = []) {
  const counts = {};
  for (const row of rows) {
    const key = row?.result?.ok ? "accepted" : row?.result?.staleCode || "rejected_unknown";
    counts[key] = finiteNumber(counts[key], 0) + 1;
  }
  return counts;
}

function validationDecisionHash(rows = []) {
  return hashText(JSON.stringify(rows.map((row) => ({
    signature: row.signature,
    result: row.result,
  }))));
}

function runExactValidationPass({
  leagueData,
  candidates = [],
  currentDate = "",
  tradeDeadlineDate = "",
  recordsByTeam = {},
} = {}) {
  const rows = [];
  const startedAt = nowMs();
  for (const candidate of candidates) {
    const candidateStartedAt = nowMs();
    const result = validateCpuTradeCandidateOnLeague({
      leagueData,
      candidate,
      currentDate,
      tradeDeadlineDate,
      inOffseason: false,
      recordsByTeam,
    });
    rows.push({
      signature: getCpuTradeCandidateSignature(candidate),
      teams: [candidate?.fromTeamName || "", candidate?.toTeamName || ""],
      package: candidatePackageShape(candidate),
      durationMs: round3(nowMs() - candidateStartedAt),
      result: validationResultSummary(result),
    });
  }
  const durations = rows.map((row) => row.durationMs);
  return {
    count: rows.length,
    totalMs: round3(nowMs() - startedAt),
    durations: summarizeDurations(durations),
    outcomes: validationOutcomeCounts(rows),
    decisionHash: validationDecisionHash(rows),
    rows,
  };
}

function selectRepeatValidationRows(rows = [], limit = 3) {
  const selected = [];
  const used = new Set();
  const desired = ["accepted", "buyer_rejected", "seller_rejected"];
  for (const outcome of desired) {
    const found = rows.find((row) => {
      const key = row?.result?.ok ? "accepted" : row?.result?.staleCode || "rejected_unknown";
      return key === outcome && !used.has(row.signature);
    });
    if (found) {
      selected.push(found);
      used.add(found.signature);
    }
  }
  for (const row of rows) {
    if (selected.length >= limit) break;
    if (used.has(row.signature)) continue;
    selected.push(row);
    used.add(row.signature);
  }
  return selected.slice(0, limit);
}

function runExactRepeatProfile({
  leagueData,
  sourceRows = [],
  candidateBySignature = new Map(),
  currentDate = "",
  tradeDeadlineDate = "",
  recordsByTeam = {},
  iterations = 5,
} = {}) {
  const loops = Math.max(2, Math.min(12, Math.trunc(finiteNumber(iterations, 5))));
  return selectRepeatValidationRows(sourceRows, 3).map((source) => {
    const candidate = candidateBySignature.get(source.signature);
    const durations = [];
    const results = [];
    for (let index = 0; index < loops; index += 1) {
      const startedAt = nowMs();
      const result = validateCpuTradeCandidateOnLeague({
        leagueData,
        candidate,
        currentDate,
        tradeDeadlineDate,
        inOffseason: false,
        recordsByTeam,
      });
      durations.push(round3(nowMs() - startedAt));
      results.push(validationResultSummary(result));
    }
    return {
      signature: source.signature,
      teams: source.teams,
      package: source.package,
      expected: source.result,
      iterations: loops,
      durations: summarizeDurations(durations),
      allDecisionsIdentical: results.every((row) => JSON.stringify(row) === JSON.stringify(results[0])),
      decisionHash: hashText(JSON.stringify(results)),
    };
  });
}

export async function runCpuTradeValidationMicroDiagnostics({
  leagueData,
  selectedTeam = null,
  download = true,
  maxCandidates = 36,
  repeatIterations = 5,
} = {}) {
  if (!leagueData || typeof leagueData !== "object") {
    throw new Error("CPU_TRADE_VALIDATION_MICROPROFILE_MISSING_LEAGUE_DATA");
  }

  const startedAt = nowMs();
  const fixture = cloneJson(leagueData);
  const fixtureBeforeHash = hashText(JSON.stringify(fixture));
  const currentDate = inferCurrentDate(fixture);
  const tradeDeadlineDate = inferTradeDeadlineDate(fixture, currentDate);
  const candidateLimit = Math.max(6, Math.min(60, Math.trunc(finiteNumber(maxCandidates, 36))));
  const recordsByTeam = {};
  const generationContext = makeGeneratorContext(fixture, selectedTeam, candidateLimit);
  generationContext.currentDate = currentDate;
  generationContext.tradeDeadlineDate = tradeDeadlineDate;
  generationContext.recordsByTeam = recordsByTeam;
  generationContext.generationNonce = 920001;
  generationContext.generationReason = "validation_microprofile";

  const report = {
    name: "basketball_manager_cpu_trade_validation_microprofile",
    version: VALIDATION_MICROPROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    safety: {
      seasonSimulationRun: false,
      liveLeagueMutation: false,
      activeSaveWritten: false,
      candidatesPersisted: false,
      validationReadOnly: true,
      leagueUsesJsonClone: true,
    },
    context: {
      seasonYear: inferSeasonYear(fixture),
      currentDate,
      tradeDeadlineDate,
      selectedTeamName: inferSelectedTeamName(selectedTeam, fixture),
      teamCount: getAllTeams(fixture).length,
      recordsMode: "explicit_empty_snapshot",
      requestedCandidates: candidateLimit,
    },
    generation: null,
    validation: null,
    errors: [],
  };

  try {
    prewarmCpuTradeWorker();
    const generationStartedAt = nowMs();
    const generated = await getCpuCpuTradeCandidates(fixture, generationContext);
    const candidates = Array.isArray(generated?.candidates) ? generated.candidates.slice(0, candidateLimit) : [];
    report.generation = {
      ok: true,
      wallMs: round3(nowMs() - generationStartedAt),
      requestedCandidates: candidateLimit,
      returnedCandidates: candidates.length,
      tradeDeskItems: Array.isArray(generated?.tradeDeskItems) ? generated.tradeDeskItems.length : 0,
      workerTiming: generated?.debug?.workerTiming || null,
    };

    if (!candidates.length) throw new Error("CPU_TRADE_VALIDATION_MICROPROFILE_NO_CANDIDATES");

    const candidateBySignature = new Map(candidates.map((candidate) => [getCpuTradeCandidateSignature(candidate), candidate]));
    resetCpuTradeImpactCache();
    const cacheBeforeCold = getCpuTradeImpactCacheStats();
    const coldPass = runExactValidationPass({
      leagueData: fixture,
      candidates,
      currentDate,
      tradeDeadlineDate,
      recordsByTeam,
    });
    const cacheAfterCold = getCpuTradeImpactCacheStats();
    const warmPass = runExactValidationPass({
      leagueData: fixture,
      candidates,
      currentDate,
      tradeDeadlineDate,
      recordsByTeam,
    });
    const cacheAfterWarm = getCpuTradeImpactCacheStats();
    const repeatRows = runExactRepeatProfile({
      leagueData: fixture,
      sourceRows: coldPass.rows,
      candidateBySignature,
      currentDate,
      tradeDeadlineDate,
      recordsByTeam,
      iterations: repeatIterations,
    });
    const parity = coldPass.decisionHash === warmPass.decisionHash && coldPass.rows.every((row, index) => (
      JSON.stringify(row.result) === JSON.stringify(warmPass.rows[index]?.result)
    ));

    report.validation = {
      ok: parity && repeatRows.every((row) => row.allDecisionsIdentical),
      candidateCount: candidates.length,
      coldPass,
      warmPass,
      repeatRows,
      cpuImpactCache: {
        beforeCold: cacheBeforeCold,
        afterCold: cacheAfterCold,
        afterWarm: cacheAfterWarm,
      },
      decisionParity: parity,
      totalWarmSpeedupPct: coldPass.totalMs > 0
        ? round3((1 - warmPass.totalMs / coldPass.totalMs) * 100)
        : 0,
      medianWarmSpeedupPct: coldPass.durations.medianMs > 0
        ? round3((1 - warmPass.durations.medianMs / coldPass.durations.medianMs) * 100)
        : 0,
    };
  } catch (error) {
    report.errors.push({ stage: report.generation ? "validation" : "generation", error: error?.message || String(error || "") });
  }

  const fixtureAfterHash = hashText(JSON.stringify(fixture));
  report.safety.fixtureUnchanged = fixtureBeforeHash === fixtureAfterHash;
  report.safety.fixtureBeforeHash = fixtureBeforeHash;
  report.safety.fixtureAfterHash = fixtureAfterHash;
  report.elapsedMs = round3(nowMs() - startedAt);
  report.ok = report.errors.length === 0 && Boolean(report.validation?.ok) && report.safety.fixtureUnchanged;

  if (download) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJson(report, `bm_cpu_trade_validation_microprofile_${stamp}.json`);
  }

  return report;
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function runSimSpeedMicroDiagnostics({
  leagueData,
  selectedTeam = null,
  download = true,
  benchmarkIterations = 9,
} = {}) {
  if (!leagueData || typeof leagueData !== "object") {
    throw new Error("SIM_SPEED_MICROPROFILE_MISSING_LEAGUE_DATA");
  }

  const startedAt = nowMs();
  const report = {
    name: "basketball_manager_sim_speed_microprofile",
    version: MICROPROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    safety: {
      seasonSimulationRun: false,
      liveLeagueMutation: false,
      activeSaveWritten: false,
      storageUsesIsolatedTemporaryDatabase: true,
      generatorCandidatesPersisted: false,
      repairRunsOnJsonClones: true,
    },
    context: {
      seasonYear: inferSeasonYear(leagueData),
      currentDate: inferCurrentDate(leagueData),
      selectedTeamName: inferSelectedTeamName(selectedTeam, leagueData),
      teamCount: getAllTeams(leagueData).length,
      cpuTradeBankPresent: Boolean(leagueData?.cpuTradeBankState),
    },
    validation: null,
    generation: null,
    storage: null,
    rosterRepair: null,
    errors: [],
  };

  try {
    report.validation = {
      ok: true,
      rows: runCpuTradePackageBenchmarks({ iterations: benchmarkIterations }),
    };
  } catch (error) {
    report.validation = { ok: false, error: error?.message || String(error || "") };
    report.errors.push({ stage: "validation", error: report.validation.error });
  }

  try {
    report.generation = await runGeneratorProfile(leagueData, selectedTeam);
  } catch (error) {
    report.generation = { ok: false, error: error?.message || String(error || "") };
    report.errors.push({ stage: "generation", error: report.generation.error });
  }

  try {
    report.storage = await runStorageProfile(leagueData);
  } catch (error) {
    report.storage = { ok: false, error: error?.message || String(error || "") };
    report.errors.push({ stage: "storage", error: report.storage.error });
  }

  try {
    report.rosterRepair = await runRepairProfile(leagueData, selectedTeam);
  } catch (error) {
    report.rosterRepair = { ok: false, error: error?.message || String(error || "") };
    report.errors.push({ stage: "rosterRepair", error: report.rosterRepair.error });
  }

  report.elapsedMs = round3(nowMs() - startedAt);
  report.ok = report.errors.length === 0;

  if (download) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJson(report, `bm_sim_speed_microprofile_${stamp}.json`);
  }

  return report;
}
