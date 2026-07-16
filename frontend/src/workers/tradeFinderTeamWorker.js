function installStorageShim(name) {
  try {
    if (typeof globalThis[name] !== "undefined") return;
    const store = new Map();
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: false,
      value: {
        get length() {
          return store.size;
        },
        key(index) {
          return Array.from(store.keys())[Number(index) || 0] ?? null;
        },
        getItem(key) {
          key = String(key);
          return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
          store.set(String(key), String(value));
        },
        removeItem(key) {
          store.delete(String(key));
        },
        clear() {
          store.clear();
        },
      },
    });
  } catch {}
}

// Some Trade Finder dependencies read localStorage/sessionStorage while doing
// exact validation. Workers do not provide those browser globals, so install a
// tiny in-memory shim before dynamically importing the engine.
installStorageShim("localStorage");
installStorageShim("sessionStorage");

let enginePromise = null;
async function getEngine() {
  if (!enginePromise) enginePromise = import("../utils/tradeFinderOfferEngine.js");
  return enginePromise;
}

function serializeError(error) {
  return {
    message: error?.message || String(error || "Unknown Trade Finder worker error"),
    stack: error?.stack || "",
    name: error?.name || "Error",
  };
}

self.onmessage = async (event) => {
  const message = event?.data || {};
  if (message.type !== "run_batch") return;
  const workerId = message.workerId || 0;

  try {
    const { runTradeFinderTeamBatch } = await getEngine();
    const result = await runTradeFinderTeamBatch({
      ...(message.payload || {}),
      onTeamDone: (summary) => {
        self.postMessage({ type: "team_done", workerId, summary });
      },
    });
    self.postMessage({ type: "complete", workerId, result });
  } catch (error) {
    self.postMessage({ type: "error", workerId, error: serializeError(error) });
  }
};
