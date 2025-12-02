// ============================================================
// simEnginePy.js — Supports Single + Batch Simulation
// ============================================================
console.log("### simEnginePy loaded:", import.meta.url);

import { queueSim } from "@/api/simQueue";

let worker = null;

let pending = new Map();
let batchPending = new Map();
let counter = 0;

// ------------------------------------------------------------
// DEEP SANITIZE (unchanged)
// ------------------------------------------------------------
export function deepSanitize(obj, seen = new WeakSet()) {
  if (obj === null || obj === undefined) return null;
  const t = typeof obj;
  if (t === "string" || t === "number" || t === "boolean") return obj;
  if (t === "function" || t === "symbol") return null;

  if (Array.isArray(obj)) {
    if (seen.has(obj)) return null;
    seen.add(obj);
    return obj.map((v) => deepSanitize(v, seen));
  }

  if (t === "object") {
    if (seen.has(obj)) return null;
    seen.add(obj);
    const out = {};
    for (const k in obj) {
      if (k.startsWith("__react") || k === "_reactInternals") continue;
      out[k] = deepSanitize(obj[k], seen);
    }
    return out;
  }

  return null;
}

// ------------------------------------------------------------
// WORKER INIT
// ------------------------------------------------------------
function startWorker() {
  if (worker) return;

  worker = new Worker("/workers/simWorkerV2.js");

  worker.onmessage = (e) => {
    const msg = e.data;

    // ready
    if (msg.type === "ready") {
      console.log("[simEnginePy] Worker ready");
      return;
    }

    // single result
// single result
if (msg.type === "result-single") {
  const entry = pending.get(msg.id);
  if (entry) {
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    console.log("[simEnginePy] result-single for id", msg.id);
    entry.resolve(convert(msg.result));
  } else {
    console.warn(
      "[simEnginePy] result-single for unknown id",
      msg.id,
      msg
    );
  }
  return;
}



    // batch result
    if (msg.type === "result-batch") {
      const fn = batchPending.get(msg.batchId);
      if (fn) {
        batchPending.delete(msg.batchId);
        fn(
          msg.results.map((x) => ({
            id: x.id,
            result: convert(x.result),
          }))
        );
      }
      return;
    }
  };

  worker.postMessage({ type: "init" });
}

startWorker();


// ------------------------------------------------------------
// PY → JS converter
// ------------------------------------------------------------
function convert(py) {
  if (!py) return null;
  const o = Array.isArray(py) ? Object.fromEntries(py) : py;

  if (Array.isArray(o.score)) o.score = Object.fromEntries(o.score);
  if (Array.isArray(o.box_home)) o.box_home = o.box_home.map((r) => Object.fromEntries(r));
  if (Array.isArray(o.box_away)) o.box_away = o.box_away.map((r) => Object.fromEntries(r));

  return o;
}

// ------------------------------------------------------------
// PUBLIC API — SINGLE GAME
// ------------------------------------------------------------
// how long to wait for a single game before giving up
// make this aggressive so “weird” games get retried quickly
const WORKER_TIMEOUT_MS = 150; // 2.5 seconds, tweak if you want



// ------------------------------------------------------------
// PUBLIC API — SINGLE GAME (with timeout)
// ------------------------------------------------------------
export function simulateOneGame({ homeTeam, awayTeam }) {
  return queueSim(() => {
    return new Promise((resolve) => {
      const id = counter++;

      const entry = {
        resolve,
        timer: null,
      };

      // aggressive timeout in case worker never responds
      entry.timer = setTimeout(() => {
        if (!pending.has(id)) return; // already handled

        pending.delete(id);
        console.warn(
          "[simEnginePy] TIMEOUT waiting for worker result id",
          id
        );
        // this will be caught by the retry wrapper on the React side
        resolve({ error: "WORKER_TIMEOUT" });
      }, WORKER_TIMEOUT_MS);

      pending.set(id, entry);

      worker.postMessage({
        type: "simulate-single",
        id,
        home: deepSanitize(homeTeam),
        away: deepSanitize(awayTeam),
      });
    });
  });
}




// ------------------------------------------------------------
// PUBLIC API — BATCH GAME SCHEDULING
// games = [{ id, homeTeam, awayTeam }]
// ------------------------------------------------------------
export function simulateBatchGames(games) {
  return new Promise((resolve) => {
    const batchId = "B" + counter++;
    batchPending.set(batchId, resolve);

    worker.postMessage({
      type: "simulate-batch",
      batchId,
      games: games.map((g) => ({
        id: g.id,
        home: deepSanitize(g.homeTeam),
        away: deepSanitize(g.awayTeam),
      })),
    });
  });
}
