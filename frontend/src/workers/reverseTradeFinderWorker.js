function installStorageShim(name) {
  try {
    if (typeof globalThis[name] !== "undefined") return;
    const store = new Map();
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: false,
      value: {
        get length() { return store.size; },
        key(index) { return Array.from(store.keys())[Number(index) || 0] ?? null; },
        getItem(key) { key = String(key); return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(String(key), String(value)); },
        removeItem(key) { store.delete(String(key)); },
        clear() { store.clear(); },
      },
    });
  } catch {}
}

installStorageShim("localStorage");
installStorageShim("sessionStorage");

function serializeError(error) {
  return {
    message: error?.message || String(error || "Unknown Reverse Trade Finder worker error"),
    stack: error?.stack || "",
    name: error?.name || "Error",
  };
}

self.onmessage = async (event) => {
  const message = event?.data || {};
  if (message.type !== "run_reverse") return;
  try {
    const { runReverseTradeFinderSearch } = await import("../utils/reverseTradeFinderOfferEngine.js");
    const result = await runReverseTradeFinderSearch({
      ...(message.payload || {}),
      onProgress: (payload) => self.postMessage({ type: "progress", payload }),
    });
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({ type: "error", error: serializeError(error) });
  }
};
