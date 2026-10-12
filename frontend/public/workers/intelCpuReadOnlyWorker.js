/* Dedicated READ-ONLY League Intel Python observer worker.
 * Loads the same published Python files as gameplay, without importing or
 * modifying any gameplay worker, Python decision code or save state.
 */
let runtimePromise = null;
const MODULE_DIR = "/home/pyodide/league_intel_readonly";
const MODULES = [
  "cpu_cpu_trade_logic.py",
  "trade_team_ai.py",
  "trade_value_model.py",
  "league_intel_readonly.py",
];

async function ready() {
  if (!runtimePromise) runtimePromise = (async () => {
    if (!self.loadPyodide) importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
    const py = await self.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
    py.FS.mkdirTree(MODULE_DIR);
    py.runPython(`import sys\nif '${MODULE_DIR}' not in sys.path: sys.path.insert(0, '${MODULE_DIR}')`);
    for (const name of MODULES) {
      const res = await fetch(`/python/${name}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`League Intel Python module ${name}: HTTP ${res.status}`);
      const source = await res.text();
      if (/^\s*<!doctype|^\s*<html/i.test(source)) throw new Error(`League Intel expected Python but received HTML: ${name}`);
      py.FS.writeFile(`${MODULE_DIR}/${name}`, source);
    }
    py.runPython("import importlib; importlib.invalidate_caches(); import league_intel_readonly");
    return py;
  })().catch((error) => {
    runtimePromise = null; // Allow reinitialization after a network/runtime failure.
    throw error;
  });
  return runtimePromise;
}

// Frequent season ticks/franchise switches can supersede an older request
// while Pyodide is starting. Keep only the latest unstarted request. Nothing
// is ever written to saved league state, and completed old replies are ignored
// by the calling adapter's unique-request-id mapping.
let pending = null;
let running = false;
async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      const { id, payload } = job;
      try {
        const py = await ready();
        // Skip obsolete work queued during expensive Pyodide initialization.
        if (pending) continue;
        py.globals.set("intel_observer_input_json", JSON.stringify(payload || {}));
        let raw;
        try {
          raw = py.runPython("league_intel_readonly.get_intel_cpu_profile_json(intel_observer_input_json)");
        } finally {
          py.globals.delete("intel_observer_input_json");
        }
        self.postMessage({ id, ok: true, value: JSON.parse(raw) });
      } catch (error) {
        if (!pending) self.postMessage({ id, ok: false, error: error?.message || String(error) });
      }
    }
  } finally {
    running = false;
  }
}
self.onmessage = (event) => {
  const { id, payload } = event.data || {};
  if (!id) return;
  pending = { id, payload };
  drain();
};
