import { saveCpuTradeBankStateOverlay, saveLeagueData } from "./leagueStorage.js";
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

function hasCpuTradeReason(coveredReasonCounts = {}) {
  return Boolean(
    Number(coveredReasonCounts?.bank_state_only || 0) > 0 ||
    Number(coveredReasonCounts?.trade_or_roster_change || 0) > 0
  );
}

function getLeagueSaveSource(batch = {}) {
  const counts = batch?.coveredReasonCounts || {};
  const cpuReason = hasCpuTradeReason(counts);
  const injuryReason = Number(counts?.injury_state || 0) > 0 || Number(counts?.injury_alerts_disabled || 0) > 0;

  if (cpuReason && injuryReason) return "shared_latest_league_save_queue";
  if (injuryReason) return "Calendar.injuryStateQueue";
  return "cpu_trade_save_queue";
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
  getSaveMode = (reason) => (reason === "bank_state_only" ? "bank_overlay" : "full_league"),
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
            const result = await save(batch.leagueData, batch);
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
                latestReason: batch.latestReason,
                saveMode: batch.saveMode,
                coveredReasonCounts: batch.coveredReasonCounts,
                coveredBankStateOnlyRequestCount: batch.coveredReasonCounts?.bank_state_only || 0,
                coveredFullLeagueRequestCount: batch.coveredFullLeagueRequestCount || 0,
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
                latestReason: batch.latestReason,
                saveMode: batch.saveMode,
                coveredReasonCounts: batch.coveredReasonCounts,
                coveredBankStateOnlyRequestCount: batch.coveredReasonCounts?.bank_state_only || 0,
                coveredFullLeagueRequestCount: batch.coveredFullLeagueRequestCount || 0,
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
    const requestedSaveMode = getSaveMode(reason) === "bank_overlay"
      ? "bank_overlay"
      : "full_league";

    const previousReasonCounts = pending?.coveredReasonCounts || {};
    const coveredReasonCounts = {
      ...previousReasonCounts,
      [String(reason || "cpu_trade")]: finiteNumber(previousReasonCounts?.[String(reason || "cpu_trade")], 0) + 1,
    };
    const saveMode =
      pending?.saveMode === "full_league" || requestedSaveMode === "full_league"
        ? "full_league"
        : "bank_overlay";
    const fullSaveReason =
      requestedSaveMode === "full_league"
        ? String(reason || "cpu_trade")
        : pending?.fullSaveReason || "";
    const effectiveReason = fullSaveReason || String(reason || "cpu_trade");

    const batch = {
      leagueData,
      currentDate,
      reason: effectiveReason,
      latestReason: String(reason || "cpu_trade"),
      fullSaveReason,
      saveMode,
      requestedSaveMode,
      coveredReasonCounts,
      coveredFullLeagueRequestCount:
        finiteNumber(pending?.coveredFullLeagueRequestCount, 0) +
        (requestedSaveMode === "full_league" ? 1 : 0),
      requestId,
      enqueuedAt,
      traceEnabled,
      approximatePayloadBytes: 0,
      serializationEstimateMs: 0,
      firstCoveredRequestId: pending?.firstCoveredRequestId || requestId,
      coveredRequestCount: finiteNumber(pending?.coveredRequestCount, 0) + 1,
    };

    if (traceEnabled) {
      const serializationStartedAt = now();
      try {
        const payload = saveMode === "bank_overlay"
          ? leagueData?.cpuTradeBankState || null
          : leagueData;
        batch.approximatePayloadBytes = JSON.stringify(payload).length;
      } catch {}
      batch.serializationEstimateMs = Math.max(
        0,
        finiteNumber(now() - serializationStartedAt, 0)
      );
    }

    pending = batch;

    const resultPromise = new Promise((resolve, reject) => {
      waiters.push({ requestId, resolve, reject });
    });

    if (traceEnabled) {
      recordCpuTradeTrace("storage", "save_enqueued", {
        requestId,
        currentDate,
        reason: effectiveReason,
        latestReason: batch.latestReason,
        saveMode,
        coveredReasonCounts,
        approximatePayloadBytes: batch.approximatePayloadBytes,
        serializationEstimateMs: batch.serializationEstimateMs,
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
  save: (leagueData, batch) => {
    const source = getLeagueSaveSource(batch);
    return batch?.saveMode === "bank_overlay"
      ? saveCpuTradeBankStateOverlay(leagueData, { source })
      : saveLeagueData(leagueData, { source });
  },
  now: cpuTradeNow,
  onWrite: (row) => {
    // Injury persistence shares this latest-only writer so full-league saves
    // cannot race CPU-trade saves. Keep CPU-trade telemetry limited to actual
    // CPU-trade requests so the performance report remains meaningful.
    if (!hasCpuTradeReason(row.coveredReasonCounts || {})) return;

    const mode = row.saveMode === "bank_overlay"
      ? "latest_only_cpu_bank_overlay"
      : "latest_only_full_league";
    recordCpuTradeTiming("storageMs", row.durationMs, {
      reason: row.reason,
      latestReason: row.latestReason,
      saveMode: row.saveMode,
      ok: row.ok,
      mode,
      coveredRequestCount: row.coveredRequestCount,
      coalescedRequestCount: row.coalescedRequestCount,
      coveredBankStateOnlyRequestCount: row.coveredBankStateOnlyRequestCount || 0,
      coveredFullLeagueRequestCount: row.coveredFullLeagueRequestCount || 0,
    });
    recordCpuTradeStorageWrite({
      currentDate: row.currentDate,
      reason: row.reason,
      latestReason: row.latestReason,
      saveMode: row.saveMode,
      coveredReasonCounts: row.coveredReasonCounts || {},
      coveredBankStateOnlyRequestCount: row.coveredBankStateOnlyRequestCount || 0,
      coveredFullLeagueRequestCount: row.coveredFullLeagueRequestCount || 0,
      ok: row.ok,
      durationMs: row.durationMs,
      mode,
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
        latestReason: row.latestReason,
        saveMode: row.saveMode,
        coveredReasonCounts: row.coveredReasonCounts || {},
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
