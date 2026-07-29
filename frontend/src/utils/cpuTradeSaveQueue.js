import { saveLeagueData } from "./leagueStorage.js";
import {
  cpuTradeNow,
  isCpuTradeDeepTraceEnabled,
  recordCpuTradeStorageWrite,
  recordCpuTradeTiming,
  recordCpuTradeTrace,
} from "./cpuTradeTelemetry.js";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Creates a latest-state-only async save queue.
 *
 * Every enqueue call is covered by either the exact snapshot it supplied or a
 * newer snapshot. While one IndexedDB write is in flight, intermediate queued
 * snapshots are replaced by the latest state instead of opening overlapping
 * full-league transactions that can finish out of order.
 */
export function createLatestOnlySaveQueue({
  save,
  now = () => Date.now(),
  onWrite = null,
} = {}) {
  if (typeof save !== "function") {
    throw new TypeError("createLatestOnlySaveQueue requires a save function.");
  }

  let nextRequestId = 0;
  let latestPersistedRequestId = 0;
  let pending = null;
  let drainPromise = null;
  const waiters = [];

  function settleCoveredWaiters(upToRequestId, error = null, value = null) {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.requestId > upToRequestId) continue;
      waiters.splice(index, 1);
      if (error) waiter.reject(error);
      else waiter.resolve(value);
    }
  }

  function startDrain() {
    if (drainPromise) return drainPromise;

    drainPromise = Promise.resolve()
      .then(async () => {
        while (pending) {
          const batch = pending;
          pending = null;
          const startedAt = now();

          try {
            const result = await save(batch.leagueData);
            const durationMs = Math.max(0, finiteNumber(now() - startedAt, 0));
            latestPersistedRequestId = Math.max(
              latestPersistedRequestId,
              batch.requestId
            );

            if (typeof onWrite === "function") {
              onWrite({
                ok: true,
                durationMs,
                requestId: batch.requestId,
                firstCoveredRequestId: batch.firstCoveredRequestId,
                coveredRequestCount: batch.coveredRequestCount,
                coalescedRequestCount: Math.max(0, batch.coveredRequestCount - 1),
                currentDate: batch.currentDate,
                reason: batch.reason,
                queueWaitMs: Math.max(0, finiteNumber(startedAt - batch.enqueuedAt, 0)),
                approximatePayloadBytes: batch.approximatePayloadBytes || 0,
                serializationEstimateMs: batch.serializationEstimateMs || 0,
              });
            }

            settleCoveredWaiters(batch.requestId, null, {
              ok: true,
              result,
              requestId: batch.requestId,
              persistedRequestId: latestPersistedRequestId,
              coveredRequestCount: batch.coveredRequestCount,
            });
          } catch (error) {
            const durationMs = Math.max(0, finiteNumber(now() - startedAt, 0));

            if (typeof onWrite === "function") {
              onWrite({
                ok: false,
                durationMs,
                requestId: batch.requestId,
                firstCoveredRequestId: batch.firstCoveredRequestId,
                coveredRequestCount: batch.coveredRequestCount,
                coalescedRequestCount: Math.max(0, batch.coveredRequestCount - 1),
                currentDate: batch.currentDate,
                reason: batch.reason,
                queueWaitMs: Math.max(0, finiteNumber(startedAt - batch.enqueuedAt, 0)),
                approximatePayloadBytes: batch.approximatePayloadBytes || 0,
                serializationEstimateMs: batch.serializationEstimateMs || 0,
                error: error?.message || String(error || ""),
              });
            }

            settleCoveredWaiters(batch.requestId, error);
          }
        }
      })
      .finally(() => {
        drainPromise = null;
        // An enqueue can land after the loop observes an empty queue but before
        // this finally block runs. Restart immediately so that request is not
        // stranded behind a resolved drain promise.
        if (pending) startDrain();
      });

    return drainPromise;
  }

  function enqueue({ leagueData, currentDate = "", reason = "cpu_trade" } = {}) {
    if (!leagueData || typeof leagueData !== "object") {
      return Promise.resolve({
        ok: false,
        skipped: true,
        reason: "missing_league_data",
      });
    }

    const requestId = ++nextRequestId;
    const enqueuedAt = now();
    const traceEnabled = isCpuTradeDeepTraceEnabled();
    const queueStateBefore = traceEnabled
      ? {
          pending: Boolean(pending),
          inFlight: Boolean(drainPromise),
          waiterCount: waiters.length,
        }
      : null;
    let approximatePayloadBytes = 0;
    let serializationEstimateMs = 0;
    if (traceEnabled) {
      const serializationStartedAt = now();
      try { approximatePayloadBytes = JSON.stringify(leagueData).length; } catch {}
      serializationEstimateMs = Math.max(0, finiteNumber(now() - serializationStartedAt, 0));
    }

    if (pending) {
      pending = {
        leagueData,
        currentDate,
        reason,
        requestId,
        enqueuedAt,
        traceEnabled,
        approximatePayloadBytes,
        serializationEstimateMs,
        firstCoveredRequestId: pending.firstCoveredRequestId,
        coveredRequestCount: pending.coveredRequestCount + 1,
      };
    } else {
      pending = {
        leagueData,
        currentDate,
        reason,
        requestId,
        enqueuedAt,
        traceEnabled,
        approximatePayloadBytes,
        serializationEstimateMs,
        firstCoveredRequestId: requestId,
        coveredRequestCount: 1,
      };
    }

    const resultPromise = new Promise((resolve, reject) => {
      waiters.push({ requestId, resolve, reject });
    });

    if (traceEnabled) {
      recordCpuTradeTrace("storage", "save_enqueued", {
        requestId,
        currentDate,
        reason,
        approximatePayloadBytes,
        serializationEstimateMs,
        queueStateBefore,
        pendingCoveredRequestCount: pending?.coveredRequestCount || 0,
        waiterCountAfter: waiters.length,
      });
    }
    startDrain();
    return resultPromise;
  }

  async function flush() {
    while (pending || drainPromise) {
      if (!drainPromise && pending) startDrain();
      if (drainPromise) await drainPromise;
    }

    return {
      pending: false,
      latestPersistedRequestId,
      latestRequestedId: nextRequestId,
      waiterCount: waiters.length,
    };
  }

  function getState() {
    return {
      pending: Boolean(pending),
      inFlight: Boolean(drainPromise),
      pendingRequestId: pending?.requestId || null,
      pendingCoveredRequestCount: pending?.coveredRequestCount || 0,
      latestPersistedRequestId,
      latestRequestedId: nextRequestId,
      waiterCount: waiters.length,
    };
  }

  return {
    enqueue,
    flush,
    getState,
  };
}

const cpuTradeLeagueSaveQueue = createLatestOnlySaveQueue({
  save: saveLeagueData,
  now: cpuTradeNow,
  onWrite: (row) => {
    recordCpuTradeTiming("storageMs", row.durationMs, {
      reason: row.reason,
      ok: row.ok,
      mode: "latest_only_indexeddb_queue",
      coveredRequestCount: row.coveredRequestCount,
      coalescedRequestCount: row.coalescedRequestCount,
    });
    recordCpuTradeStorageWrite({
      currentDate: row.currentDate,
      reason: row.reason,
      ok: row.ok,
      durationMs: row.durationMs,
      mode: "latest_only_indexeddb_queue",
      requestId: row.requestId,
      firstCoveredRequestId: row.firstCoveredRequestId,
      coveredRequestCount: row.coveredRequestCount,
      coalescedRequestCount: row.coalescedRequestCount,
      queueWaitMs: row.queueWaitMs || 0,
      approximatePayloadBytes: row.approximatePayloadBytes || 0,
      serializationEstimateMs: row.serializationEstimateMs || 0,
      error: row.error || "",
    });
    if (isCpuTradeDeepTraceEnabled()) {
      recordCpuTradeTrace("storage", row.ok ? "save_completed" : "save_failed", {
        currentDate: row.currentDate,
        reason: row.reason,
        requestId: row.requestId,
        firstCoveredRequestId: row.firstCoveredRequestId,
        coveredRequestCount: row.coveredRequestCount,
        coalescedRequestCount: row.coalescedRequestCount,
        queueWaitMs: row.queueWaitMs || 0,
        serializationEstimateMs: row.serializationEstimateMs || 0,
        approximatePayloadBytes: row.approximatePayloadBytes || 0,
        indexedDbTransactionMs: row.durationMs,
        error: row.error || "",
      });
    }
  },
});

export function enqueueCpuTradeLeagueSave(payload = {}) {
  return cpuTradeLeagueSaveQueue.enqueue(payload);
}

export function flushCpuTradeLeagueSaves() {
  if (!isCpuTradeDeepTraceEnabled()) {
    return cpuTradeLeagueSaveQueue.flush();
  }

  const startedAt = cpuTradeNow();
  const before = cpuTradeLeagueSaveQueue.getState();
  recordCpuTradeTrace("storage", "forced_flush_started", { queueState: before });
  return cpuTradeLeagueSaveQueue.flush().then(
    (result) => {
      const forcedFlushMs = cpuTradeNow() - startedAt;
      recordCpuTradeTiming("forcedStorageFlushMs", forcedFlushMs, {
        latestPersistedRequestId: result?.latestPersistedRequestId || 0,
        latestRequestedId: result?.latestRequestedId || 0,
      });
      recordCpuTradeTrace("storage", "forced_flush_completed", {
        forcedFlushMs,
        queueStateBefore: before,
        result,
      });
      return result;
    },
    (error) => {
      recordCpuTradeTrace("storage", "forced_flush_failed", {
        forcedFlushMs: cpuTradeNow() - startedAt,
        queueStateBefore: before,
        error: error?.message || String(error || ""),
      });
      throw error;
    }
  );
}

export function getCpuTradeLeagueSaveQueueState() {
  return cpuTradeLeagueSaveQueue.getState();
}
