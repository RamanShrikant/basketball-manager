// src/api/cpuTradeEngine.js
// Thin JS wrapper around the season CPU-to-CPU trade Pyodide worker.

let worker = null;
let counter = 0;
const pending = new Map();

function startCpuTradeWorker() {
  if (worker) return;

  worker = new Worker("/workers/cpuTradeSeasonWorker.js");

  worker.onmessage = (event) => {
    const msg = event.data || {};
    const entry = pending.get(msg.requestId);
    if (!entry) return;

    if (msg.type === "cpu-cpu-trade-candidates-result") {
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      entry.resolve(msg.payload || { ok: true, candidates: [] });
      return;
    }

    if (msg.type === "cpu-cpu-trade-candidates-error") {
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      entry.reject(new Error(msg.error || "CPU-to-CPU trade worker failed"));
    }
  };

  worker.onerror = (error) => {
    console.warn("[cpuTradeEngine] worker error", error);
  };
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

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("CPU_CPU_TRADE_CANDIDATES_TIMEOUT"));
    }, TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });

    worker.postMessage({
      type: "cpu-cpu-trade-candidates",
      requestId,
      payload: deepSanitize({
        leagueData,
        context,
      }),
    });
  });
}
