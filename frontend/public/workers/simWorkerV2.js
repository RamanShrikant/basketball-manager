// ============================================================
// simWorkerV2.js — Batch-safe Pyodide Simulation Worker
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
    const code = await fetch(`/python/${file}?v=${Date.now()}`).then((r) => r.text());

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
// AWARDS MODE ✅
// NOTE: your awards.py expects compute_awards(players, seasonYear)
// ------------------------------------------------------------
async function computeAwards(requestId, players, seasonYear) {
  try {
    pyodide.globals.set("players_js", pyodide.toPy(players || []));
    pyodide.globals.set("season_js", seasonYear ?? null);

    const pyRes = await pyodide.runPythonAsync(`
from awards import compute_awards
res = compute_awards(players_js, season_js)
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
// FINALS MVP MODE ✅
// calls awards.py compute_finals_mvp(players, championTeam, seasonYear)
// ------------------------------------------------------------
// ------------------------------------------------------------
// FINALS MVP MODE ✅
// ------------------------------------------------------------
async function computeFinalsMvp(requestId, players, meta) {
  try {
    pyodide.globals.set("players_js", pyodide.toPy(players || []));
    pyodide.globals.set("meta_js", pyodide.toPy(meta || {}));

    const pyRes = await pyodide.runPythonAsync(`
import importlib
import awards
importlib.reload(awards)
from awards import compute_finals_mvp

champion = meta_js.get("championTeam") if hasattr(meta_js, "get") else None
season = meta_js.get("seasonYear") if hasattr(meta_js, "get") else None

res = compute_finals_mvp(players_js, champion, season)
res
    `);

    const finalsMvp = pyRes.toJs({ dict_converter: Object.fromEntries });


    postMessage({
      type: "finals-mvp-result",
      requestId,
      finalsMvp,
    });
  } catch (err) {
    console.error("[simWorkerV2] computeFinalsMvp error:", err);
    postMessage({
      type: "finals-mvp-error",
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

  // awards
  if (msg.type === "compute-awards") {
    const seasonYear = msg.meta?.seasonYear ?? null;
    return computeAwards(msg.requestId, msg.players, seasonYear);
  }

  // finals mvp
  if (msg.type === "compute-finals-mvp") {
    return computeFinalsMvp(msg.requestId, msg.players, msg.meta || {});
  }
};
