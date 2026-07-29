import { validateCpuTradeCandidateOnLeague } from "../utils/tradeExecution.js";
import {
  cpuTradeValidationParityMatches,
  mergeIndexedCpuTradeValidationResults,
  partitionIndexedCpuTradeCandidates,
} from "../utils/cpuTradeValidationProtocol.js";
import {
  cpuTradeNow,
  getCpuTradeRuntimeGauges,
  isCpuTradeDeepTraceEnabled,
  recordCpuTradeTiming,
  recordCpuTradeTrace,
  setCpuTradeRuntimeGauge,
} from "../utils/cpuTradeTelemetry.js";

const MAX_POOL_SIZE = 6;
const MIN_POOL_SIZE = 2;
const DEFAULT_TIMEOUT_MS = 60000;
const FIXED_STORAGE_KEYS = [
  "bm_trade_builder_v1",
  "bm_trade_deadline_status_v1",
  "bm_offseason_state_v1",
  "bm_draft_lottery_v1",
  "bm_draft_state_v1",
  "bm_trade_finder_impact_mode_v1",
  "bm_trade_debug_v1",
  "bm_trade_finder_impact_breakdown_v1",
  "bm_trade_pick_breakdown_v1",
];

const objectTokens = new WeakMap();
let nextObjectToken = 1;
let workers = [];
let requestCounter = 0;
let disabledReason = "";
let prewarmPromise = null;
const parityCheckedSnapshots = new Set();

function objectToken(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return "primitive";
  }
  if (!objectTokens.has(value)) objectTokens.set(value, nextObjectToken++);
  return objectTokens.get(value);
}

function hardwareConcurrency() {
  const value = Number(globalThis?.navigator?.hardwareConcurrency || 4);
  return Number.isFinite(value) && value > 0 ? value : 4;
}

function desiredPoolSize() {
  const available = Math.max(MIN_POOL_SIZE, hardwareConcurrency() - 2);
  return Math.max(MIN_POOL_SIZE, Math.min(MAX_POOL_SIZE, available));
}

function rejectAllPending(slot, error) {
  for (const pending of slot.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  slot.pending.clear();
}

function makeWorkerSlot(index) {
  const worker = new Worker(
    new URL("../workers/cpuTradeValidationWorker.js", import.meta.url),
    { type: "module" }
  );

  const slot = {
    worker,
    index,
    pending: new Map(),
    snapshotKey: "",
  };

  worker.addEventListener("message", (event) => {
    const response = event.data || {};
    const pending = slot.pending.get(response.requestId);
    if (!pending) return;
    slot.pending.delete(response.requestId);
    clearTimeout(pending.timer);
    if (pending.traceEnabled) {
      const receivedAt = cpuTradeNow();
      const receivedAtEpochMs = Date.now();
      const diagnosticTiming = response?.diagnosticTiming || {};
      response.__roundTripMs = Math.max(0, receivedAt - Number(pending.createdAt || receivedAt));
      response.__queueDepthAtPost = Number(pending.queueDepthAtPost || 0);
      response.__messageType = pending.messageType || "";
      response.__queueAndInboundTransferMs = Math.max(
        0,
        Number(diagnosticTiming?.workerDequeuedAtEpochMs || 0) - Number(pending.createdAtEpochMs || 0)
      );
      response.__outboundTransferAndDispatchMs = Math.max(
        0,
        receivedAtEpochMs - Number(diagnosticTiming?.workerCompletedAtEpochMs || receivedAtEpochMs)
      );
    }

    if (response.type === "validate-batch-error") {
      pending.reject(new Error(response.error || "CPU trade validation worker failed"));
      return;
    }

    pending.resolve(response);
  });

  worker.addEventListener("error", (event) => {
    const error = event instanceof Error ? event : new Error(event?.message || String(event));
    rejectAllPending(slot, error);
    slot.snapshotKey = "";
  });

  return slot;
}

function ensureWorkers() {
  if (disabledReason) return [];
  const count = desiredPoolSize();
  while (workers.length < count) workers.push(makeWorkerSlot(workers.length));
  return workers;
}

function relevantStorageEntries(leagueData = {}) {
  const keys = new Set(FIXED_STORAGE_KEYS);
  const entries = [];

  try {
    if (typeof localStorage === "undefined") return entries;

    const teams = Array.isArray(leagueData?.teams)
      ? leagueData.teams
      : leagueData?.conferences && typeof leagueData.conferences === "object"
        ? Object.values(leagueData.conferences).flat()
        : [];

    for (const team of teams) {
      const teamName = team?.name || team?.teamName || team?.team || "";
      if (teamName) keys.add(`gameplan_${teamName}`);
    }

    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value != null) entries.push([key, value]);
    }
  } catch {}

  return entries;
}

function storageFingerprint(entries = []) {
  let hash = 2166136261;
  const source = entries
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join("|");

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildSnapshotKey(leagueData = {}, storageEntries = []) {
  const teams = leagueData?.conferences || leagueData?.teams || leagueData;
  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  const picks = Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [];
  const financials = leagueData?.financials || leagueData?.leagueFinancials || null;

  return [
    Number(
      leagueData?.seasonYear ||
        leagueData?.currentSeasonYear ||
        leagueData?.seasonStartYear ||
        0
    ),
    objectToken(teams),
    objectToken(history),
    history.length,
    objectToken(picks),
    picks.length,
    objectToken(financials),
    storageFingerprint(storageEntries),
  ].join("|");
}

function makeValidationLeagueSnapshot(leagueData = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  const snapshot = { ...leagueData };
  delete snapshot.cpuTradeBankState;
  return snapshot;
}

function postToSlot(slot, message, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const requestId = `CTV${requestCounter++}`;
    const timer = setTimeout(() => {
      slot.pending.delete(requestId);
      reject(new Error("CPU_TRADE_VALIDATION_POOL_TIMEOUT"));
    }, timeoutMs);

    const traceEnabled = isCpuTradeDeepTraceEnabled();
    const postedAtEpochMs = traceEnabled ? Date.now() : 0;
    slot.pending.set(requestId, {
      resolve,
      reject,
      timer,
      ...(traceEnabled
        ? {
            createdAt: cpuTradeNow(),
            createdAtEpochMs: postedAtEpochMs,
            queueDepthAtPost: slot.pending.size,
            messageType: message?.type || "",
            traceEnabled: true,
          }
        : {}),
    });
    slot.worker.postMessage({
      ...message,
      requestId,
      ...(traceEnabled
        ? { diagnosticsTraceEnabled: true, __diagnosticPostedAtEpochMs: postedAtEpochMs }
        : {}),
    });
  });
}

async function syncSlotSnapshot(slot, snapshotKey, leagueData, storageEntries) {
  if (slot.snapshotKey === snapshotKey) return false;
  const startedAt = cpuTradeNow();
  const response = await postToSlot(slot, {
    type: "sync-snapshot",
    snapshotKey,
    leagueData,
    storageEntries,
  });

  if (String(response?.snapshotKey || "") !== snapshotKey) {
    throw new Error("CPU_TRADE_VALIDATION_POOL_SNAPSHOT_MISMATCH");
  }

  slot.snapshotKey = snapshotKey;
  const snapshotSyncMs = cpuTradeNow() - startedAt;
  recordCpuTradeTiming("parallelValidationSnapshotSyncMs", snapshotSyncMs, {
    workerIndex: slot.index,
  });
  if (isCpuTradeDeepTraceEnabled()) {
    recordCpuTradeTrace("validation", "snapshot_synced", {
      workerIndex: slot.index,
      snapshotKey,
      snapshotSyncMs,
      workerRoundTripMs: Number(response?.__roundTripMs || 0),
      queueAndInboundTransferMs: Number(response?.__queueAndInboundTransferMs || 0),
      outboundTransferAndDispatchMs: Number(response?.__outboundTransferAndDispatchMs || 0),
      queueDepthAtPost: Number(response?.__queueDepthAtPost || 0),
    });
  }
  return true;
}

export function disableCpuTradeValidationPool(reason = "disabled") {
  disabledReason = String(reason || "disabled");
  for (const slot of workers) {
    rejectAllPending(slot, new Error(`CPU_TRADE_VALIDATION_POOL_DISABLED:${disabledReason}`));
    try {
      slot.worker.terminate();
    } catch {}
  }
  workers = [];
  prewarmPromise = null;
}

export function getCpuTradeValidationPoolStatus() {
  return {
    enabled: !disabledReason,
    disabledReason,
    workerCount: workers.length,
    desiredWorkerCount: desiredPoolSize(),
    parityCheckedSnapshotCount: parityCheckedSnapshots.size,
  };
}

export function prewarmCpuTradeValidationPool() {
  if (disabledReason) return Promise.resolve(false);
  if (prewarmPromise) return prewarmPromise;

  let slots;
  try {
    slots = ensureWorkers();
  } catch (error) {
    disableCpuTradeValidationPool(error?.message || "worker_creation_failed");
    return Promise.resolve(false);
  }

  prewarmPromise = Promise.all(
    slots.map((slot) => postToSlot(slot, { type: "prewarm" }).catch(() => null))
  ).then((rows) => rows.filter(Boolean).length === slots.length);

  return prewarmPromise;
}

export async function validateCpuTradeCandidatesParallel({
  leagueData,
  candidates = [],
  currentDate = "",
  tradeDeadlineDate = "",
  inOffseason = false,
  recordsByTeam,
} = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return [];
  if (disabledReason) {
    throw new Error(`CPU_TRADE_VALIDATION_POOL_DISABLED:${disabledReason}`);
  }
  if (!recordsByTeam || typeof recordsByTeam !== "object") {
    throw new Error("CPU_TRADE_VALIDATION_POOL_REQUIRES_RECORD_SNAPSHOT");
  }

  const availableSlots = ensureWorkers();
  const slotCount = Math.min(availableSlots.length, rows.length);
  if (slotCount < 2 || rows.length < 2) {
    throw new Error("CPU_TRADE_VALIDATION_POOL_NOT_WORTHWHILE");
  }

  const slots = availableSlots.slice(0, slotCount);
  const traceEnabled = isCpuTradeDeepTraceEnabled();
  const snapshotPreparationStartedAt = traceEnabled ? cpuTradeNow() : 0;
  const storageEntries = relevantStorageEntries(leagueData);
  const snapshotKey = buildSnapshotKey(leagueData, storageEntries);
  const leagueSnapshot = makeValidationLeagueSnapshot(leagueData);
  const snapshotPreparationMs = traceEnabled
    ? cpuTradeNow() - snapshotPreparationStartedAt
    : 0;
  const wallStartedAt = cpuTradeNow();

  if (traceEnabled) {
    setCpuTradeRuntimeGauge("validationActiveWorkers", slots.length);
    setCpuTradeRuntimeGauge("validationCandidateCount", rows.length);
    recordCpuTradeTrace("validation", "batch_started", {
      currentDate,
      snapshotKey,
      candidateCount: rows.length,
      workerCount: slots.length,
      snapshotPreparationMs,
      storageEntryCount: storageEntries.length,
      generationWorkload: getCpuTradeRuntimeGauges(),
    });
  }

  try {
    await Promise.all(
      slots.map((slot) =>
        syncSlotSnapshot(slot, snapshotKey, leagueSnapshot, storageEntries)
      )
    );

    const partitions = partitionIndexedCpuTradeCandidates(rows, slots.length);
    const responses = await Promise.all(
      slots.map((slot, index) =>
        postToSlot(slot, {
          type: "validate-batch",
          snapshotKey,
          workerIndex: slot.index,
          payload: {
            candidates: partitions[index],
            currentDate,
            tradeDeadlineDate,
            inOffseason,
            recordsByTeam,
          },
        })
      )
    );

    const merged = mergeIndexedCpuTradeValidationResults(responses, rows.length);
    const wallMs = cpuTradeNow() - wallStartedAt;
    const workerComputeMs = responses.reduce(
      (sum, response) => sum + Number(response?.batchDurationMs || 0),
      0
    );

    recordCpuTradeTiming("parallelValidationWallMs", wallMs, {
      candidateCount: rows.length,
      workerCount: slots.length,
    });
    recordCpuTradeTiming("parallelValidationWorkerComputeMs", workerComputeMs, {
      candidateCount: rows.length,
      workerCount: slots.length,
    });
    recordCpuTradeTiming("exactValidationMs", wallMs, {
      phase: "admission_parallel",
      candidateCount: rows.length,
      workerCount: slots.length,
    });

    if (traceEnabled) {
      const workerRoundTripMs = responses.reduce(
        (sum, response) => sum + Number(response?.__roundTripMs || 0),
        0
      );
      const queueAndInboundTransferMs = responses.reduce(
        (sum, response) => sum + Number(response?.__queueAndInboundTransferMs || 0),
        0
      );
      const outboundTransferAndDispatchMs = responses.reduce(
        (sum, response) => sum + Number(response?.__outboundTransferAndDispatchMs || 0),
        0
      );
      const queueAndTransferMsEstimate = Math.max(0, workerRoundTripMs - workerComputeMs);

      recordCpuTradeTrace("validation", "batch_completed", {
        currentDate,
        snapshotKey,
        candidateCount: rows.length,
        workerCount: slots.length,
        snapshotPreparationMs,
        wallMs,
        workerComputeMs,
        workerRoundTripMs,
        queueAndTransferMsEstimate,
        queueAndInboundTransferMs,
        outboundTransferAndDispatchMs,
        partitionSizes: partitions.map((partition) => partition.length),
        workerRows: responses.map((response) => ({
          workerIndex: response?.workerIndex ?? null,
          batchDurationMs: Number(response?.batchDurationMs || 0),
          roundTripMs: Number(response?.__roundTripMs || 0),
          queueAndInboundTransferMs: Number(response?.__queueAndInboundTransferMs || 0),
          outboundTransferAndDispatchMs: Number(response?.__outboundTransferAndDispatchMs || 0),
          queueDepthAtPost: Number(response?.__queueDepthAtPost || 0),
          resultCount: Array.isArray(response?.results) ? response.results.length : 0,
        })),
        generationWorkload: getCpuTradeRuntimeGauges(),
      });
    }

    if (!parityCheckedSnapshots.has(snapshotKey)) {
      const parityIndex = rows.findIndex(Boolean);
      if (parityIndex >= 0) {
        const serial = validateCpuTradeCandidateOnLeague({
          leagueData,
          candidate: rows[parityIndex],
          currentDate,
          tradeDeadlineDate,
          inOffseason,
          recordsByTeam,
        });

        if (!cpuTradeValidationParityMatches(serial, merged[parityIndex].result)) {
          disableCpuTradeValidationPool("serial_worker_parity_mismatch");
          throw new Error("CPU_TRADE_VALIDATION_POOL_PARITY_MISMATCH");
        }
      }
      parityCheckedSnapshots.add(snapshotKey);
    }

    return merged;
  } catch (error) {
    if (traceEnabled) {
      recordCpuTradeTrace("validation", "batch_failed", {
        currentDate,
        snapshotKey,
        candidateCount: rows.length,
        workerCount: slots.length,
        elapsedMs: cpuTradeNow() - wallStartedAt,
        error: error?.message || String(error || ""),
      });
    }
    throw error;
  } finally {
    if (traceEnabled) {
      setCpuTradeRuntimeGauge("validationActiveWorkers", 0);
      setCpuTradeRuntimeGauge("validationCandidateCount", 0);
    }
  }
}
