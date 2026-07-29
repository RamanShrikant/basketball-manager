// src/api/cpuTradeEngine.js
// JS wrapper around a persistent pool of season CPU-to-CPU trade Pyodide workers.
//
// V5B preservation rule:
// - every worker still executes the original cpu_cpu_trade_logic.py generator;
// - requests remain individually seeded by the existing generationNonce;
// - the pool only overlaps independent generation passes;
// - callers consume responses in the original serial order.

import {
  cpuTradeNow,
  isCpuTradeDeepTraceEnabled,
  recordCpuTradeGenerationJob,
  recordCpuTradeTiming,
  recordCpuTradeTrace,
  setCpuTradeRuntimeGauge,
} from "../utils/cpuTradeTelemetry.js";

const MAX_GENERATION_WORKERS = 4;
const REQUEST_TIMEOUT_MS = 30000;

let workerSlots = [];
let counter = 0;
const pending = new Map();
const queuedRequestIds = [];

function generationPoolSnapshot() {
  const activeWorkers = workerSlots.filter((slot) => slot?.busy).length;
  return {
    workerCount: workerSlots.length,
    activeWorkers,
    idleWorkers: Math.max(0, workerSlots.length - activeWorkers),
    queuedRequests: queuedRequestIds.length,
    pendingRequests: pending.size,
  };
}

function publishGenerationPoolGauges() {
  const snapshot = generationPoolSnapshot();
  if (isCpuTradeDeepTraceEnabled()) {
    setCpuTradeRuntimeGauge("generationWorkerCount", snapshot.workerCount);
    setCpuTradeRuntimeGauge("generationActiveWorkers", snapshot.activeWorkers);
    setCpuTradeRuntimeGauge("generationQueuedRequests", snapshot.queuedRequests);
    setCpuTradeRuntimeGauge("generationPendingRequests", snapshot.pendingRequests);
  }
  return snapshot;
}

export function getCpuTradeGenerationPoolStatus() {
  return generationPoolSnapshot();
}

function desiredWorkerCount() {
  let hardware = 4;
  try {
    hardware = Math.max(2, Number(globalThis?.navigator?.hardwareConcurrency || 4));
  } catch {}
  return hardware >= 12 ? 4 : hardware >= 8 ? 3 : 2;
}

function makeCpuTradeCancellationError(reason = "cancelled") {
  const error = new Error(`CPU_CPU_TRADE_CANDIDATES_CANCELLED:${reason}`);
  error.code = "CPU_CPU_TRADE_CANDIDATES_CANCELLED";
  return error;
}

function compactPlayer(player = {}) {
  return {
    id: player?.id ?? player?.playerId ?? null,
    name: player?.name || player?.player || "",
    pos: player?.pos || player?.position || "",
    secondaryPos: player?.secondaryPos || null,
    age: player?.age,
    overall: player?.overall ?? player?.ovr,
    potential: player?.potential ?? player?.pot,
    offRating: player?.offRating,
    defRating: player?.defRating,
    stamina: player?.stamina,
    salary: player?.salary,
    currentSalary: player?.currentSalary,
    capHit: player?.capHit,
    contract: player?.contract,
    rosterStatus: player?.rosterStatus,
    isTwoWay: player?.isTwoWay,
    isStash: player?.isStash,
  };
}

function compactLeagueForCpuTrades(leagueData = {}) {
  const compactTeam = (team = {}) => ({
    name: team?.name || team?.teamName || team?.team || "",
    conference: team?.conference || team?.conf || "",
    players: (team?.players || []).map(compactPlayer),
  });
  const compact = {
    seasonYear: leagueData?.seasonYear,
    currentSeasonYear: leagueData?.currentSeasonYear,
    draftPicks: leagueData?.draftPicks || [],
    tradeHistory: (leagueData?.tradeHistory || []).slice(-120),
  };
  if (Array.isArray(leagueData?.teams)) compact.teams = leagueData.teams.map(compactTeam);
  else if (leagueData?.conferences) {
    compact.conferences = Object.fromEntries(
      Object.entries(leagueData.conferences).map(([name, teams]) => [name, (teams || []).map(compactTeam)])
    );
  }
  return compact;
}

function deepSanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "function" || t === "symbol") return null;

  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    return value.map((item) => deepSanitize(item, seen));
  }

  if (t === "object") {
    if (seen.has(value)) return null;
    seen.add(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("__react") || key === "_reactInternals") continue;
      out[key] = deepSanitize(item, seen);
    }
    return out;
  }

  return null;
}

function replaceWorkerSlot(slotIndex, reason = "worker_reset") {
  const previous = workerSlots[slotIndex];
  try { previous?.worker?.terminate(); } catch {}
  workerSlots[slotIndex] = makeWorkerSlot(slotIndex);
  try {
    workerSlots[slotIndex]?.worker?.postMessage({ type: "cpu-cpu-trade-prewarm" });
  } catch {}
  recordCpuTradeGenerationJob({
    event: "worker_replaced",
    workerIndex: slotIndex,
    reason,
  });
}

function finishEntry(requestId, { payload = null, error = null, event = "fulfilled", dispatch = true } = {}) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.timer);

  const slot = Number.isInteger(entry.slotIndex) ? workerSlots[entry.slotIndex] : null;
  if (slot?.requestId === requestId) {
    slot.busy = false;
    slot.requestId = null;
  }

  const workerRoundTripMs = cpuTradeNow() - Number(entry.assignedAt || entry.createdAt || cpuTradeNow());
  const candidateCount = Array.isArray(payload?.candidates) ? payload.candidates.length : 0;
  const traceEnabled = isCpuTradeDeepTraceEnabled();
  const workerTiming = traceEnabled ? payload?.debug?.workerTiming || null : null;
  const workerMeasuredMs = workerTiming
    ? [
        workerTiming.readyWaitMs,
        workerTiming.inputSerializationMs,
        workerTiming.pythonExecutionMs,
        workerTiming.resultParseMs,
        workerTiming.responsePreparationMs,
      ].reduce((sum, value) => sum + Number(value || 0), 0)
    : 0;
  const resultTransferAndDispatchMsEstimate = traceEnabled
    ? Math.max(0, workerRoundTripMs - workerMeasuredMs)
    : 0;
  const pool = traceEnabled ? publishGenerationPoolGauges() : null;

  recordCpuTradeTiming("workerGenerationMs", workerRoundTripMs, {
    requestId,
    workerIndex: entry.slotIndex,
    candidateCount,
    error: error?.message || null,
  });
  recordCpuTradeGenerationJob({
    event,
    requestId,
    workerIndex: entry.slotIndex,
    workerRoundTripMs,
    candidateCount,
    tradeDeskItemCount: Array.isArray(payload?.tradeDeskItems) ? payload.tradeDeskItems.length : 0,
    generationNonce: entry?.context?.generationNonce ?? null,
    currentDate: entry?.context?.currentDate || "",
    error: error?.message || null,
  });
  if (traceEnabled) {
    recordCpuTradeTrace("generation", event, {
      requestId,
      workerIndex: entry.slotIndex,
      generationNonce: entry?.context?.generationNonce ?? null,
      currentDate: entry?.context?.currentDate || "",
      reason: entry?.context?.generationReason || entry?.context?.reason || "",
      requestedCandidates: entry?.context?.maxCandidates ?? null,
      returnedCandidates: candidateCount,
      queueWaitMs: Math.max(0, Number(entry.assignedAt || entry.createdAt || 0) - Number(entry.createdAt || 0)),
      payloadPreparationMs: Number(entry.payloadPreparationMs || 0),
      approximatePayloadBytes: Number(entry.approximatePayloadBytes || 0),
      workerRoundTripMs,
      workerTiming,
      resultTransferAndDispatchMsEstimate,
      pool,
      error: error?.message || null,
    });
  }

  if (error) entry.reject(error);
  else entry.resolve(payload || { ok: true, candidates: [] });

  if (dispatch) dispatchQueuedRequests();
}

function makeWorkerSlot(index) {
  const worker = new Worker("/workers/cpuTradeSeasonWorker.js");
  const slot = {
    index,
    worker,
    busy: false,
    requestId: null,
  };

  worker.onmessage = (event) => {
    const msg = event.data || {};
    const requestId = msg.requestId;
    if (!requestId || slot.requestId !== requestId) return;

    if (msg.type === "cpu-cpu-trade-candidates-result") {
      finishEntry(requestId, {
        payload: msg.payload || { ok: true, candidates: [] },
        event: "fulfilled",
      });
      return;
    }

    if (msg.type === "cpu-cpu-trade-candidates-error") {
      finishEntry(requestId, {
        error: new Error(msg.error || "CPU-to-CPU trade worker failed"),
        event: "rejected",
      });
    }
  };

  worker.onerror = (workerError) => {
    console.warn("[cpuTradeEngine] generation worker error", workerError);
    const requestId = slot.requestId;
    if (requestId) {
      finishEntry(requestId, {
        error: new Error("CPU_CPU_TRADE_WORKER_ERROR"),
        event: "rejected",
        dispatch: false,
      });
    }
    replaceWorkerSlot(index, "worker_error");
    dispatchQueuedRequests();
  };

  return slot;
}

function ensureWorkerPool() {
  const target = desiredWorkerCount();
  while (workerSlots.length < target) {
    workerSlots.push(makeWorkerSlot(workerSlots.length));
  }
  if (isCpuTradeDeepTraceEnabled()) publishGenerationPoolGauges();
  return workerSlots;
}

function removeQueuedRequestId(requestId) {
  const index = queuedRequestIds.indexOf(requestId);
  if (index >= 0) queuedRequestIds.splice(index, 1);
}

function dispatchQueuedRequests() {
  ensureWorkerPool();
  for (const slot of workerSlots) {
    if (slot.busy) continue;

    let requestId = null;
    let entry = null;
    while (queuedRequestIds.length && !entry) {
      requestId = queuedRequestIds.shift();
      entry = pending.get(requestId) || null;
    }
    if (!entry || !requestId) break;

    slot.busy = true;
    slot.requestId = requestId;
    entry.slotIndex = slot.index;
    entry.assignedAt = cpuTradeNow();
    entry.status = "running";
    entry.timer = setTimeout(() => {
      const liveEntry = pending.get(requestId);
      if (!liveEntry) return;
      finishEntry(requestId, {
        error: new Error("CPU_CPU_TRADE_CANDIDATES_TIMEOUT"),
        event: "timeout",
        dispatch: false,
      });
      replaceWorkerSlot(slot.index, "request_timeout");
      dispatchQueuedRequests();
    }, REQUEST_TIMEOUT_MS);

    const traceEnabled = isCpuTradeDeepTraceEnabled();
    const assignedPool = traceEnabled ? publishGenerationPoolGauges() : null;
    recordCpuTradeGenerationJob({
      event: "assigned",
      requestId,
      workerIndex: slot.index,
      queueWaitMs: entry.assignedAt - Number(entry.createdAt || entry.assignedAt),
      generationNonce: entry?.context?.generationNonce ?? null,
      currentDate: entry?.context?.currentDate || "",
    });
    if (traceEnabled) {
      recordCpuTradeTrace("generation", "assigned", {
        requestId,
        workerIndex: slot.index,
        generationNonce: entry?.context?.generationNonce ?? null,
        currentDate: entry?.context?.currentDate || "",
        queueWaitMs: entry.assignedAt - Number(entry.createdAt || entry.assignedAt),
        requestedCandidates: entry?.context?.maxCandidates ?? null,
        pool: assignedPool,
      });
    }

    try {
      slot.worker.postMessage({
        type: "cpu-cpu-trade-candidates",
        requestId,
        payload: entry.payload,
        ...(traceEnabled ? { diagnosticsTraceEnabled: true } : {}),
      });
    } catch (postError) {
      finishEntry(requestId, {
        error: postError instanceof Error ? postError : new Error(String(postError || "worker_post_failed")),
        event: "rejected",
        dispatch: false,
      });
      replaceWorkerSlot(slot.index, "post_message_failed");
      dispatchQueuedRequests();
    }
  }
}

function cancelRequest(requestId, reason = "cancelled") {
  const entry = pending.get(requestId);
  if (!entry) return false;

  removeQueuedRequestId(requestId);
  const error = makeCpuTradeCancellationError(reason);

  if (entry.status === "running" && Number.isInteger(entry.slotIndex)) {
    const slotIndex = entry.slotIndex;
    finishEntry(requestId, { error, event: "cancelled", dispatch: false });
    replaceWorkerSlot(slotIndex, reason);
  } else {
    pending.delete(requestId);
    clearTimeout(entry.timer);
    recordCpuTradeGenerationJob({
      event: "cancelled",
      requestId,
      reason,
      workerRoundTripMs: cpuTradeNow() - Number(entry.createdAt || cpuTradeNow()),
      generationNonce: entry?.context?.generationNonce ?? null,
      currentDate: entry?.context?.currentDate || "",
    });
    entry.reject(error);
  }

  dispatchQueuedRequests();
  return true;
}

export function cancelCpuTradeWorkerGeneration(reason = "superseded", requestId = null) {
  if (requestId) return cancelRequest(requestId, reason) ? 1 : 0;

  const requestIds = [...pending.keys()];
  for (const id of requestIds) cancelRequest(id, reason);
  return requestIds.length;
}

export function prewarmCpuTradeWorker() {
  const slots = ensureWorkerPool();
  for (const slot of slots) {
    try { slot.worker.postMessage({ type: "cpu-cpu-trade-prewarm" }); } catch {}
  }
  recordCpuTradeGenerationJob({
    event: "pool_prewarm",
    workerCount: slots.length,
  });
}

function prepareCompactLeague(leagueData = {}) {
  const startedAt = cpuTradeNow();
  const compacted = compactLeagueForCpuTrades(leagueData);
  const compactLeague = deepSanitize(compacted);
  const payloadCompactionMs = cpuTradeNow() - startedAt;
  recordCpuTradeTiming("payloadCompactionMs", payloadCompactionMs, {
    sharedGenerationSnapshot: true,
  });
  return { compactLeague, payloadCompactionMs };
}

function enqueuePreparedRequest(compactLeague, context = {}, sharedDetails = {}) {
  ensureWorkerPool();
  const requestId = `CCT${counter++}`;
  const payloadStartedAt = cpuTradeNow();
  const sanitizedContext = deepSanitize(context);
  const payload = {
    leagueData: compactLeague,
    context: sanitizedContext,
  };

  let approximatePayloadBytes = Number(sharedDetails.approximateLeagueBytes || 0);
  const payloadSizeStartedAt = cpuTradeNow();
  try {
    approximatePayloadBytes += JSON.stringify(sanitizedContext || {}).length;
  } catch {}
  const payloadSerializationEstimateMs = cpuTradeNow() - payloadSizeStartedAt;
  const payloadPreparationMs = cpuTradeNow() - payloadStartedAt + Number(sharedDetails.payloadCompactionMs || 0);

  recordCpuTradeTiming("payloadSerializationEstimateMs", payloadSerializationEstimateMs, {
    requestId,
    approximatePayloadBytes,
  });
  recordCpuTradeTiming("generationPayloadMs", payloadPreparationMs, {
    requestId,
    approximatePayloadBytes,
    sharedGenerationSnapshot: Boolean(sharedDetails.sharedGenerationSnapshot),
  });

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  promise.requestId = requestId;
  promise.cancel = (reason = "caller_cancelled") => cancelRequest(requestId, reason);

  pending.set(requestId, {
    requestId,
    payload,
    context,
    createdAt: cpuTradeNow(),
    assignedAt: null,
    slotIndex: null,
    status: "queued",
    payloadPreparationMs,
    approximatePayloadBytes,
    timer: null,
    resolve: resolvePromise,
    reject: rejectPromise,
  });
  queuedRequestIds.push(requestId);

  const traceEnabled = isCpuTradeDeepTraceEnabled();
  const launchedPool = traceEnabled ? publishGenerationPoolGauges() : null;
  recordCpuTradeGenerationJob({
    event: "launched",
    requestId,
    payloadPreparationMs,
    approximatePayloadBytes,
    generationNonce: context?.generationNonce ?? null,
    currentDate: context?.currentDate || "",
    maxCandidates: context?.maxCandidates ?? null,
    sharedGenerationSnapshot: Boolean(sharedDetails.sharedGenerationSnapshot),
  });
  if (traceEnabled) {
    recordCpuTradeTrace("generation", "launched", {
      requestId,
      generationNonce: context?.generationNonce ?? null,
      currentDate: context?.currentDate || "",
      reason: context?.generationReason || context?.reason || "",
      requestedCandidates: context?.maxCandidates ?? null,
      bankSize: context?.bankSize ?? null,
      remainingTarget: context?.remainingTarget ?? null,
      payloadPreparationMs,
      payloadCompactionMs: Number(sharedDetails.payloadCompactionMs || 0),
      approximatePayloadBytes,
      sharedGenerationSnapshot: Boolean(sharedDetails.sharedGenerationSnapshot),
      pool: launchedPool,
    });
  }

  dispatchQueuedRequests();
  return promise;
}

export function getCpuCpuTradeCandidates(leagueData, context = {}) {
  const { compactLeague, payloadCompactionMs } = prepareCompactLeague(leagueData);
  let approximateLeagueBytes = 0;
  try { approximateLeagueBytes = JSON.stringify(compactLeague || {}).length; } catch {}
  return enqueuePreparedRequest(compactLeague, context, {
    approximateLeagueBytes,
    payloadCompactionMs,
    sharedGenerationSnapshot: false,
  });
}

export function startCpuCpuTradeCandidateBatch(leagueData, contexts = []) {
  const rows = Array.isArray(contexts) ? contexts : [];
  if (!rows.length) {
    return {
      rows: [],
      requestIds: [],
      done: Promise.resolve([]),
      cancelRemaining: () => 0,
    };
  }

  const batchStartedAt = cpuTradeNow();
  const { compactLeague, payloadCompactionMs } = prepareCompactLeague(leagueData);
  let approximateLeagueBytes = 0;
  try { approximateLeagueBytes = JSON.stringify(compactLeague || {}).length; } catch {}

  const requests = rows.map((context, index) => enqueuePreparedRequest(compactLeague, context, {
    approximateLeagueBytes,
    payloadCompactionMs: index === 0 ? payloadCompactionMs : 0,
    sharedGenerationSnapshot: true,
  }));

  const rowPromises = requests.map((request, index) =>
    request.then(
      (response) => ({
        index,
        requestId: request?.requestId || null,
        ok: true,
        response,
        error: null,
      }),
      (error) => ({
        index,
        requestId: request?.requestId || null,
        ok: false,
        response: null,
        error,
      })
    )
  );

  const done = Promise.all(rowPromises).then((settledRows) => {
    const batchWallMs = cpuTradeNow() - batchStartedAt;
    const fulfilled = settledRows.filter((row) => row.ok).length;
    const rejected = settledRows.length - fulfilled;

    recordCpuTradeTiming("parallelGenerationBatchMs", batchWallMs, {
      passCount: rows.length,
      fulfilled,
      rejected,
      workerCount: workerSlots.length,
    });
    recordCpuTradeGenerationJob({
      event: "parallel_batch_summary",
      durationMs: batchWallMs,
      passCount: rows.length,
      fulfilledCount: fulfilled,
      rejectedCount: rejected,
      workerCount: workerSlots.length,
      generationNonces: rows.map((row) => row?.generationNonce ?? null),
      currentDate: rows[0]?.currentDate || "",
    });
    if (isCpuTradeDeepTraceEnabled()) {
      recordCpuTradeTrace("generation", "parallel_batch_summary", {
        durationMs: batchWallMs,
        passCount: rows.length,
        fulfilledCount: fulfilled,
        rejectedCount: rejected,
        generationNonces: rows.map((row) => row?.generationNonce ?? null),
        currentDate: rows[0]?.currentDate || "",
        pool: publishGenerationPoolGauges(),
      });
    }

    return settledRows;
  });

  return {
    rows: rowPromises,
    requestIds: requests.map((request) => request?.requestId || null),
    done,
    cancelRemaining(reason = "parallel_batch_unused", fromIndex = 0) {
      let cancelled = 0;
      for (let index = Math.max(0, fromIndex); index < requests.length; index += 1) {
        if (requests[index]?.cancel?.(reason)) cancelled += 1;
      }
      return cancelled;
    },
  };
}

export async function getCpuCpuTradeCandidateBatch(leagueData, contexts = []) {
  return startCpuCpuTradeCandidateBatch(leagueData, contexts).done;
}
