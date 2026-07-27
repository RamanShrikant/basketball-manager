// src/api/cpuTradeEngine.js
// Thin JS wrapper around the season CPU-to-CPU trade Pyodide worker.

import {
  cpuTradeNow,
  recordCpuTradeGenerationJob,
  recordCpuTradeTiming,
} from "../utils/cpuTradeTelemetry.js";

let worker = null;
let counter = 0;
const pending = new Map();

function makeCpuTradeCancellationError(reason = "cancelled") {
  const error = new Error(`CPU_CPU_TRADE_CANDIDATES_CANCELLED:${reason}`);
  error.code = "CPU_CPU_TRADE_CANDIDATES_CANCELLED";
  return error;
}

function terminateCpuTradeWorker(reason = "cancelled", { rejectPending = true } = {}) {
  const activeWorker = worker;
  worker = null;
  try { activeWorker?.terminate(); } catch {}

  if (!rejectPending || !pending.size) return 0;

  const error = makeCpuTradeCancellationError(reason);
  const rows = [...pending.entries()];
  pending.clear();

  for (const [requestId, entry] of rows) {
    clearTimeout(entry?.timer);
    const workerRoundTripMs = cpuTradeNow() - Number(entry?.startedAt || cpuTradeNow());
    recordCpuTradeGenerationJob({
      event: "cancelled",
      requestId,
      reason,
      workerRoundTripMs,
      generationNonce: entry?.context?.generationNonce ?? null,
      currentDate: entry?.context?.currentDate || "",
    });
    try { entry?.reject(error); } catch {}
  }

  return rows.length;
}

export function cancelCpuTradeWorkerGeneration(reason = "superseded") {
  return terminateCpuTradeWorker(reason, { rejectPending: true });
}

function startCpuTradeWorker() {
  if (worker) return worker;

  worker = new Worker("/workers/cpuTradeSeasonWorker.js");

  worker.onmessage = (event) => {
    const msg = event.data || {};
    const entry = pending.get(msg.requestId);
    if (!entry) return;

    if (msg.type === "cpu-cpu-trade-candidates-result") {
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      const workerRoundTripMs = cpuTradeNow() - entry.startedAt;
      const payload = msg.payload || { ok: true, candidates: [] };
      recordCpuTradeTiming("workerGenerationMs", workerRoundTripMs, {
        requestId: msg.requestId,
        candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
      });
      recordCpuTradeGenerationJob({
        event: "fulfilled",
        requestId: msg.requestId,
        workerRoundTripMs,
        candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
        tradeDeskItemCount: Array.isArray(payload?.tradeDeskItems) ? payload.tradeDeskItems.length : 0,
        generationNonce: entry?.context?.generationNonce ?? null,
        currentDate: entry?.context?.currentDate || "",
      });
      entry.resolve(payload);
      return;
    }

    if (msg.type === "cpu-cpu-trade-candidates-error") {
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      const workerRoundTripMs = cpuTradeNow() - entry.startedAt;
      recordCpuTradeTiming("workerGenerationMs", workerRoundTripMs, {
        requestId: msg.requestId,
        error: msg.error || "CPU-to-CPU trade worker failed",
      });
      recordCpuTradeGenerationJob({
        event: "rejected",
        requestId: msg.requestId,
        workerRoundTripMs,
        error: msg.error || "CPU-to-CPU trade worker failed",
        generationNonce: entry?.context?.generationNonce ?? null,
        currentDate: entry?.context?.currentDate || "",
      });
      entry.reject(new Error(msg.error || "CPU-to-CPU trade worker failed"));
    }
  };

  worker.onerror = (error) => {
    console.warn("[cpuTradeEngine] worker error", error);
    terminateCpuTradeWorker("worker_error", { rejectPending: true });
  };
  return worker;
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

export function prewarmCpuTradeWorker() {
  const activeWorker = startCpuTradeWorker();
  try { activeWorker?.postMessage({ type: "cpu-cpu-trade-prewarm" }); } catch {}
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

export function getCpuCpuTradeCandidates(leagueData, context = {}) {
  startCpuTradeWorker();

  const requestId = `CCT${counter++}`;
  const TIMEOUT_MS = 15000;
  const payloadStartedAt = cpuTradeNow();
  const payload = deepSanitize({
    leagueData: compactLeagueForCpuTrades(leagueData),
    context,
  });
  const payloadCompactionMs = cpuTradeNow() - payloadStartedAt;
  const payloadSizeStartedAt = cpuTradeNow();
  let approximatePayloadBytes = 0;
  try {
    approximatePayloadBytes = JSON.stringify(payload).length;
  } catch {}
  const payloadSerializationEstimateMs = cpuTradeNow() - payloadSizeStartedAt;
  const payloadPreparationMs = cpuTradeNow() - payloadStartedAt;
  recordCpuTradeTiming("payloadCompactionMs", payloadCompactionMs, {
    requestId,
  });
  recordCpuTradeTiming("payloadSerializationEstimateMs", payloadSerializationEstimateMs, {
    requestId,
    approximatePayloadBytes,
  });
  recordCpuTradeTiming("generationPayloadMs", payloadPreparationMs, {
    requestId,
    approximatePayloadBytes,
  });

  return new Promise((resolve, reject) => {
    const startedAt = cpuTradeNow();
    const timer = setTimeout(() => {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      const workerRoundTripMs = cpuTradeNow() - entry.startedAt;
      recordCpuTradeTiming("workerGenerationMs", workerRoundTripMs, {
        requestId,
        timeout: true,
      });
      recordCpuTradeGenerationJob({
        event: "timeout",
        requestId,
        workerRoundTripMs,
        generationNonce: context?.generationNonce ?? null,
        currentDate: context?.currentDate || "",
      });
      // A timed-out Pyodide call keeps running unless the worker is terminated.
      // Reset it immediately so the dead request cannot block every later pass.
      const activeWorker = worker;
      worker = null;
      try { activeWorker?.terminate(); } catch {}

      for (const [queuedRequestId, queuedEntry] of [...pending.entries()]) {
        pending.delete(queuedRequestId);
        clearTimeout(queuedEntry?.timer);
        recordCpuTradeGenerationJob({
          event: "cancelled",
          requestId: queuedRequestId,
          reason: "worker_reset_after_timeout",
          workerRoundTripMs: cpuTradeNow() - Number(queuedEntry?.startedAt || cpuTradeNow()),
          generationNonce: queuedEntry?.context?.generationNonce ?? null,
          currentDate: queuedEntry?.context?.currentDate || "",
        });
        try { queuedEntry?.reject(makeCpuTradeCancellationError("worker_reset_after_timeout")); } catch {}
      }

      reject(new Error("CPU_CPU_TRADE_CANDIDATES_TIMEOUT"));
    }, TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer, startedAt, context });
    recordCpuTradeGenerationJob({
      event: "launched",
      requestId,
      payloadPreparationMs,
      approximatePayloadBytes,
      generationNonce: context?.generationNonce ?? null,
      currentDate: context?.currentDate || "",
      maxCandidates: context?.maxCandidates ?? null,
    });

    worker.postMessage({
      type: "cpu-cpu-trade-candidates",
      requestId,
      payload,
    });
  });
}
