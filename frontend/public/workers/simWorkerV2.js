// ============================================================
//  simWorkerV2.js — Batch-safe Pyodide Simulation Worker
// ============================================================
console.log("[simWorkerV2] booting…");

self.addEventListener("error", (e) =>
  console.error("[simWorkerV2] WORKER ERROR:", e)
);
self.addEventListener("unhandledrejection", (e) =>
  console.error("[simWorkerV2] UNHANDLED:", e.reason)
);

// Pyodide
importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js");

let pyodide = null;
let ready = false;

// Python files loaded from /public/python
const pythonFiles = [
  "game_sim.py",
  "bm_scoring.py",
  "efficiency.py",
  "assists.py",
  "rebounds.py",
  "awards.py",
  "steals.py",
  "blocks.py",
  "shooting_model.py",
];

async function init() {
  if (ready) return;

  console.log("[simWorkerV2] loading Pyodide…");
  pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/",
  });

  await pyodide.loadPackage("micropip");

  await pyodide.runPythonAsync(`
import sys
sys.path.append("/python")
  `);

  // load python files
  for (const file of pythonFiles) {
    const code = await fetch(`/python/${file}`).then((r) => r.text());
    pyodide.FS.writeFile(file, code);
  }

  ready = true;
  console.log("[simWorkerV2] READY");
  postMessage({ type: "ready" });
}

// Raw logging
self.addEventListener("message", (e) => {
  console.log("[simWorkerV2] MSG IN:", e.data);
});

// ------------------------------------------------------------
// SINGLE GAME MODE
// ------------------------------------------------------------
async function simulateOneGame(id, home, away) {
  try {
    pyodide.globals.set("home", pyodide.toPy(home));
    pyodide.globals.set("away", pyodide.toPy(away));

    const pyRes = await pyodide.runPythonAsync(`
from game_sim import simulate_game
result = await simulate_game(home, away)
result
    `);

    postMessage({
      type: "result-single",
      id,
      result: pyRes.toJs({ dict_converter: Object }),
    });
  } catch (err) {
    postMessage({
      type: "result-single",
      id,
      result: { error: err.toString() },
    });
  }
}

// ------------------------------------------------------------
// BATCH GAME MODE
// ------------------------------------------------------------
async function simulateBatch(batchId, games) {
  // games = [{ id, home, away }]
  console.log("[simWorkerV2] simulateBatch:", games.length, "games");

  try {
    pyodide.globals.set("games", pyodide.toPy(games));

    const pyRes = await pyodide.runPythonAsync(`
from game_sim import simulate_game
out = []
for g in games:
    h = g["home"]
    a = g["away"]
    r = await simulate_game(h, a)
    out.append({ "id": g["id"], "result": r })
out
    `);

    postMessage({
      type: "result-batch",
      batchId,
      results: pyRes.toJs({ dict_converter: Object }),
    });
  } catch (err) {
    postMessage({
      type: "result-batch",
      batchId,
      results: [],
      error: err.toString(),
    });
  }
}

// ------------------------------------------------------------
// AWARDS MODE  ✅
// ------------------------------------------------------------
async function computeAwards(requestId, players, meta) {
  try {
    // JS → Python
    pyodide.globals.set("players_js", pyodide.toPy(players));
    pyodide.globals.set("meta_js", pyodide.toPy(meta || {}));

    const pyRes = await pyodide.runPythonAsync(`
from awards import compute_awards
res = compute_awards(players_js, meta_js)
res
    `);

    const awards = pyRes.toJs({ dict_converter: Object });

    postMessage({
      type: "awards-result",
      requestId,
      awards,
    });
  } catch (err) {
    console.error("[simWorkerV2] computeAwards error:", err);
    postMessage({
      type: "awards-error",
      requestId,
      error: err.toString(),
    });
  }
}



// ------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------
onmessage = async (e) => {
  const msg = e.data;

  if (!ready) await init();

  if (msg.type === "simulate-single") {
    return simulateOneGame(msg.id, msg.home, msg.away);
  }

  if (msg.type === "simulate-batch") {
    return simulateBatch(msg.batchId, msg.games);
  }

  // 🔥 NEW: awards
  if (msg.type === "compute-awards") {
    const season = msg.meta?.seasonYear || null;
    return computeAwards(msg.requestId, msg.players, season);
  }
};

