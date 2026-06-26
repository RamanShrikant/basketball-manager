/* cpuTradeSeasonWorker.js
 * Dedicated Pyodide worker for season-timed CPU-to-CPU trade candidates.
 * Safe: proposes candidates only. Does not mutate league data or rosters.
 *
 * Loads:
 * - frontend/public/python/cpu_cpu_trade_logic.py
 */

let pyodide = null;
let pyodideReadyPromise = null;

const PY_MODULE_DIR = "/home/pyodide/cpu_trade_season";
const MODULE_FILENAME = "cpu_cpu_trade_logic.py";
const REQUIRED_MARKER = "def find_cpu_cpu_trade_candidates_json";

function looksLikeHtml(text) {
  const head = String(text || "").trim().slice(0, 160).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<title>");
}

async function fetchPythonSource() {
  const path = `/python/${MODULE_FILENAME}?v=${Date.now()}`;
  const response = await fetch(path, { cache: "no-store" });
  const source = await response.text();

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  if (looksLikeHtml(source)) {
    throw new Error(`${path} returned HTML instead of Python. Put ${MODULE_FILENAME} in frontend/public/python.`);
  }

  if (!source.includes(REQUIRED_MARKER)) {
    throw new Error(`${path} loaded, but ${REQUIRED_MARKER}(...) was not found.`);
  }

  return source;
}

async function ensurePyodideReady() {
  if (pyodideReadyPromise) return pyodideReadyPromise;

  pyodideReadyPromise = (async () => {
    if (!self.loadPyodide) {
      importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
    }

    pyodide = await self.loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    });

    try {
      pyodide.FS.mkdirTree(PY_MODULE_DIR);
    } catch {}

    pyodide.runPython(`
import sys
PY_MODULE_DIR = "${PY_MODULE_DIR}"
if PY_MODULE_DIR not in sys.path:
    sys.path.insert(0, PY_MODULE_DIR)
`);

    const source = await fetchPythonSource();
    pyodide.FS.writeFile(`${PY_MODULE_DIR}/${MODULE_FILENAME}`, source);

    try {
      pyodide.runPython(`
import sys, importlib
if "cpu_cpu_trade_logic" in sys.modules:
    del sys.modules["cpu_cpu_trade_logic"]
importlib.invalidate_caches()
import cpu_cpu_trade_logic
`);
    } catch (error) {
      throw new Error(`CPU trade Python import/load error: ${error?.message || String(error)}`);
    }

    return pyodide;
  })();

  return pyodideReadyPromise;
}

function parsePythonJsonResult(resultJson) {
  try {
    return JSON.parse(resultJson);
  } catch {
    return {
      ok: false,
      candidates: [],
      skippedReason: "invalid_json",
      rawResult: String(resultJson || ""),
    };
  }
}

async function findCpuCpuTradeCandidates(requestId, payload) {
  const runtime = await ensurePyodideReady();

  try {
    runtime.globals.set("cpu_trade_payload_json_js", JSON.stringify(payload || {}));
    const resultJson = runtime.runPython(`
import cpu_cpu_trade_logic
cpu_cpu_trade_logic.find_cpu_cpu_trade_candidates_json(cpu_trade_payload_json_js)
`);

    self.postMessage({
      type: "cpu-cpu-trade-candidates-result",
      requestId,
      payload: parsePythonJsonResult(resultJson),
    });
  } finally {
    try {
      runtime.globals.delete("cpu_trade_payload_json_js");
    } catch {}
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const requestId = msg.requestId;

  try {
    if (msg.type === "cpu-cpu-trade-candidates") {
      await findCpuCpuTradeCandidates(requestId, msg.payload || {});
      return;
    }
  } catch (error) {
    self.postMessage({
      type: "cpu-cpu-trade-candidates-error",
      requestId,
      error: error?.message || String(error || "CPU trade season worker failed"),
    });
  }
};
