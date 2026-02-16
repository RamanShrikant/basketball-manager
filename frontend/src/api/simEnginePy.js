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
    if (msg.type === "result-single") {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        console.log("[simEnginePy] result-single for id", msg.id);
        entry.resolve(convert(msg.result));
      } else {
        console.warn("[simEnginePy] result-single for unknown id", msg.id, msg);
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

    // awards result
    if (msg.type === "awards-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] awards-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.awards);
      return;
    }

    // awards error
    if (msg.type === "awards-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] awards-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Awards compute failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ error: err });
      return;
    }

    // finals mvp result
    if (msg.type === "finals-mvp-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] finals-mvp-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(deepFromEntries(msg.finalsMvp));
      return;
    }

    // finals mvp error
    if (msg.type === "finals-mvp-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] finals-mvp-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Finals MVP compute failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ error: err });
      return;
    }

    // ------------------------------------------------------------
    // PLAYER PROGRESSION RESULT ✅ (SURGICAL ADD)
    // ------------------------------------------------------------
if (msg.type === "progression-result") {
  const entry = pending.get(msg.requestId);
  if (!entry) {
    console.warn("[simEnginePy] progression-result for unknown requestId", msg.requestId, msg);
    return;
  }

  pending.delete(msg.requestId);
  if (entry.timer) clearTimeout(entry.timer);

  let out = null;
  try {
    out = typeof msg.payloadJson === "string" ? JSON.parse(msg.payloadJson) : msg.payload;
  } catch (e) {
    console.error("[simEnginePy] Failed to parse progression payloadJson", e);
    out = { error: "PROGRESSION_PARSE_FAILED" };
  }

  // ✅ convert Pyodide pairs -> normal object (safe even if already object)
  out = deepFromEntries(out);

  // ✅ ultra-safe unwrap if something ever comes back nested
  if (out && typeof out === "object" && out.payload && !out.league && out.payload.league) {
    out = out.payload;
  }

  console.log("[simEnginePy] progression-result msg keys:", Object.keys(msg));
  console.log("[simEnginePy] progression-result out keys:", Object.keys(out || {}));
  console.log("[simEnginePy] progression-result out.version:", out?.version);

  entry.resolve(out);
  return;
}



    // ------------------------------------------------------------
    // PLAYER PROGRESSION ERROR ✅ (SURGICAL ADD)
    // ------------------------------------------------------------
    if (msg.type === "progression-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] progression-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Progression compute failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ error: err });
      return;
    }
  };

  worker.postMessage({ type: "init" });
}

startWorker();

function isPairsArray(x) {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    Array.isArray(x[0]) &&
    x[0].length === 2 &&
    (typeof x[0][0] === "string" || typeof x[0][0] === "number")
  );
}

function deepFromEntries(x) {
  if (isPairsArray(x)) {
    const obj = {};
    for (const [k, v] of x) obj[k] = deepFromEntries(v);
    return obj;
  }

  if (Array.isArray(x)) return x.map(deepFromEntries);

  if (x && typeof x === "object") {
    const out = {};
    for (const [k, v] of Object.entries(x)) out[k] = deepFromEntries(v);
    return out;
  }

  return x;
}

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
// PUBLIC API — SINGLE GAME (with timeout)
// ------------------------------------------------------------
const WORKER_TIMEOUT_MS = 300;

export function simulateOneGame({ homeTeam, awayTeam }) {
  return queueSim(() => {
    return new Promise((resolve) => {
      const id = counter++;

      const entry = {
        resolve,
        timer: null,
      };

      entry.timer = setTimeout(() => {
        if (!pending.has(id)) return;

        pending.delete(id);
        console.warn("[simEnginePy] TIMEOUT waiting for worker result id", id);
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

// ------------------------------------------------------------
// PUBLIC API — SEASON AWARDS
// players = array of season stat dicts (from bm_player_stats_v1)
// meta can include: { seasonYear, teams: [{team, wins, ...}] }
// ------------------------------------------------------------
export function computeSeasonAwards(players, meta = {}) {
  startWorker();

  const requestId = "A" + counter++;

  // ✅ MINIMAL: forward teams as a top-level field too
  const teams = Array.isArray(meta?.teams) ? meta.teams : [];

  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      resolve,
      reject,
      timer: null,
    });

    worker.postMessage({
      type: "compute-awards",
      requestId,
      players: deepSanitize(players),
      teams: deepSanitize(teams),
      meta,
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API — FINALS MVP
// ------------------------------------------------------------
export function computeFinalsMvp(finalsPlayers, meta = {}) {
  startWorker();

  const requestId = "F" + counter++;

  console.log("[simEnginePy] FMVP POST", {
    requestId,
    n: (finalsPlayers || []).length,
    meta,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.error("[simEnginePy] FMVP TIMEOUT waiting for worker", { requestId });
      reject(new Error("FMVP worker timeout"));
    }, 8000);

    pending.set(requestId, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      timer,
    });

    worker.postMessage({
      type: "compute-finals-mvp",
      requestId,
      players: deepSanitize(finalsPlayers),
      meta,
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API — PLAYER PROGRESSION (Python) ✅ (SURGICAL ADD)
// Returns: { league, deltas, version }
// ------------------------------------------------------------
export function computePlayerProgression(leagueData, statsByKey = {}, meta = {}) {
  startWorker();

  const requestId = "P" + counter++;

  console.log("[simEnginePy] progression POST", {
    requestId,
    seasonYear: meta?.seasonYear,
    seed: meta?.seed,
    hasLeague: !!leagueData,
    hasStats: !!statsByKey && Object.keys(statsByKey || {}).length > 0,
  });

  const PROGRESSION_TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);

      console.error("[simEnginePy] PROGRESSION TIMEOUT waiting for worker", { requestId });
      reject(new Error("PROGRESSION_WORKER_TIMEOUT"));
    }, PROGRESSION_TIMEOUT_MS);

    pending.set(requestId, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      timer,
    });

    worker.postMessage({
      type: "compute-progression",
      requestId,
      leagueData: deepSanitize(leagueData),
      statsByKey: deepSanitize(statsByKey),
      meta,
    });
  });
}

