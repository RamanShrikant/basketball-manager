import { validateCpuTradeCandidateOnLeague } from "../utils/tradeExecution.js";
import { compactCpuTradeValidationResult } from "../utils/cpuTradeValidationProtocol.js";

let activeSnapshotKey = "";
let activeLeagueData = null;
let storageMap = new Map();

function now() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

function installWorkerGlobals(entries = []) {
  storageMap = new Map(Array.isArray(entries) ? entries : []);

  const storage = {
    getItem(key) {
      const value = storageMap.get(String(key));
      return value == null ? null : String(value);
    },
    setItem(key, value) {
      storageMap.set(String(key), String(value));
    },
    removeItem(key) {
      storageMap.delete(String(key));
    },
    clear() {
      storageMap.clear();
    },
    key(index) {
      return [...storageMap.keys()][Number(index) || 0] ?? null;
    },
    get length() {
      return storageMap.size;
    },
  };

  try {
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: globalThis,
        configurable: true,
      });
    }
  } catch {}

  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
  } catch {
    globalThis.localStorage = storage;
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  const requestId = message.requestId;

  try {
    if (message.type === "prewarm") {
      installWorkerGlobals([]);
      self.postMessage({ type: "prewarm-ready", requestId });
      return;
    }

    if (message.type === "sync-snapshot") {
      installWorkerGlobals(message.storageEntries || []);
      activeSnapshotKey = String(message.snapshotKey || "");
      activeLeagueData = message.leagueData || null;
      self.postMessage({
        type: "snapshot-ready",
        requestId,
        snapshotKey: activeSnapshotKey,
      });
      return;
    }

    if (message.type !== "validate-batch") return;

    const snapshotKey = String(message.snapshotKey || "");
    if (!snapshotKey || snapshotKey !== activeSnapshotKey || !activeLeagueData) {
      throw new Error("CPU_TRADE_VALIDATION_WORKER_STALE_SNAPSHOT");
    }

    const payload = message.payload || {};
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const batchStartedAt = now();
    const results = candidates.map((row) => {
      const startedAt = now();
      const validation = validateCpuTradeCandidateOnLeague({
        leagueData: activeLeagueData,
        candidate: row?.candidate,
        currentDate: payload.currentDate || "",
        tradeDeadlineDate: payload.tradeDeadlineDate || "",
        inOffseason: Boolean(payload.inOffseason),
        recordsByTeam: payload.recordsByTeam,
      });

      return {
        index: row?.index,
        result: compactCpuTradeValidationResult(validation),
        durationMs: now() - startedAt,
      };
    });

    self.postMessage({
      type: "validate-batch-result",
      requestId,
      snapshotKey,
      workerIndex: Number(message.workerIndex ?? -1),
      batchDurationMs: now() - batchStartedAt,
      results,
    });
  } catch (error) {
    self.postMessage({
      type: "validate-batch-error",
      requestId,
      error: error?.message || String(error || "CPU trade validation worker failed"),
    });
  }
};
