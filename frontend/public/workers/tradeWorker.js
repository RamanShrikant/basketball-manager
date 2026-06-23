/* tradeWorker.js
 * Dedicated Pyodide worker for CPU trade negotiation + Trade Finder.
 * Safe: evaluates/searches only. Does not mutate league data or rosters.
 *
 * Loads split Python CPU files from frontend/public/python:
 * - trade_value_model.py
 * - trade_team_ai.py
 * - trade_negotiation_logic.py
 */

let pyodide = null;
let pyodideReadyPromise = null;

const PY_MODULE_DIR = "/home/pyodide/trade_cpu";

const PYTHON_MODULES = [
  {
    moduleName: "trade_value_model",
    outputFilename: "trade_value_model.py",
    candidates: ["trade_value_model.py", "trade_value_model_v1.py"],
    requiredMarkers: ["def player_trade_value", "def pick_trade_value", "def package_value"],
  },
  {
    moduleName: "trade_team_ai",
    outputFilename: "trade_team_ai.py",
    candidates: ["trade_team_ai.py", "trade_team_ai_v1.py"],
    requiredMarkers: ["def get_team_preferences", "def infer_team_phase"],
  },
  {
    moduleName: "trade_negotiation_logic",
    outputFilename: "trade_negotiation_logic.py",
    candidates: ["trade_negotiation_logic.py", "trade_negotiation_logic_v2.py", "trade_negotiation_logic_v1.py"],
    requiredMarkers: ["def evaluate_trade_json", "def find_trade_offers_json"],
  },
];

function looksLikeHtml(text) {
  const head = String(text || "").trim().slice(0, 160).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<title>");
}

async function fetchPythonSource(moduleSpec) {
  const cacheBust = Date.now();
  const failures = [];

  for (const filename of moduleSpec.candidates) {
    const path = `/python/${filename}?v=${cacheBust}`;

    try {
      const response = await fetch(path, { cache: "no-store" });
      const source = await response.text();

      if (!response.ok) {
        failures.push(`${path} returned HTTP ${response.status}`);
        continue;
      }

      if (looksLikeHtml(source)) {
        failures.push(
          `${path} returned HTML instead of Python. Put ${moduleSpec.outputFilename} in frontend/public/python with the exact expected name.`
        );
        continue;
      }

      const missingMarker = moduleSpec.requiredMarkers.find((marker) => !source.includes(marker));
      if (missingMarker) {
        failures.push(`${path} loaded, but ${missingMarker}(...) was not found.`);
        continue;
      }

      return { filename, source, path };
    } catch (error) {
      failures.push(`${path} failed: ${error?.message || String(error)}`);
    }
  }

  throw new Error(
    `Could not load ${moduleSpec.outputFilename}. Tried: ${failures.join(" | ")}`
  );
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

    const loaded = [];
    for (const moduleSpec of PYTHON_MODULES) {
      const { source, path } = await fetchPythonSource(moduleSpec);
      pyodide.FS.writeFile(`${PY_MODULE_DIR}/${moduleSpec.outputFilename}`, source);
      loaded.push(`${moduleSpec.outputFilename} <= ${path}`);
    }

    try {
      pyodide.runPython(`
import sys, importlib
for name in ["trade_value_model", "trade_team_ai", "trade_negotiation_logic"]:
    if name in sys.modules:
        del sys.modules[name]
importlib.invalidate_caches()
import trade_value_model
import trade_team_ai
import trade_negotiation_logic
`);
    } catch (error) {
      throw new Error(`Python module import/load error: ${error?.message || String(error)}`);
    }

    return pyodide;
  })();

  return pyodideReadyPromise;
}

function parsePythonJsonResult(resultJson, fallbackMessage) {
  try {
    return JSON.parse(resultJson);
  } catch {
    return {
      decision: "reject",
      accepted: false,
      ok: false,
      score: -999,
      message: fallbackMessage,
      rawResult: String(resultJson || ""),
    };
  }
}

async function evaluateTrade(requestId, proposal) {
  const runtime = await ensurePyodideReady();

  try {
    runtime.globals.set("proposal_json_js", JSON.stringify(proposal || {}));
    const resultJson = runtime.runPython(`
import trade_negotiation_logic
trade_negotiation_logic.evaluate_trade_json(proposal_json_js)
`);

    self.postMessage({
      type: "trade-evaluate-result",
      requestId,
      payload: parsePythonJsonResult(resultJson, "Trade negotiation returned invalid JSON."),
    });
  } finally {
    try {
      runtime.globals.delete("proposal_json_js");
    } catch {}
  }
}

async function findTradeOffers(requestId, search) {
  const runtime = await ensurePyodideReady();

  try {
    runtime.globals.set("trade_finder_json_js", JSON.stringify(search || {}));
    const resultJson = runtime.runPython(`
import trade_negotiation_logic
trade_negotiation_logic.find_trade_offers_json(trade_finder_json_js)
`);

    self.postMessage({
      type: "trade-find-offers-result",
      requestId,
      payload: parsePythonJsonResult(resultJson, "Trade Finder returned invalid JSON."),
    });
  } finally {
    try {
      runtime.globals.delete("trade_finder_json_js");
    } catch {}
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const requestId = msg.requestId;

  try {
    if (msg.type === "trade-evaluate") {
      await evaluateTrade(requestId, msg.proposal);
      return;
    }

    if (msg.type === "trade-find-offers") {
      await findTradeOffers(requestId, msg.search);
      return;
    }
  } catch (error) {
    const errorType = msg.type === "trade-find-offers" ? "trade-find-offers-error" : "trade-evaluate-error";

    self.postMessage({
      type: errorType,
      requestId,
      error: error?.message || String(error || "Trade CPU worker failed"),
    });
  }
};
