// ============================================================
// simEnginePy.js - Supports Single + Batch Simulation
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

    if (msg.type === "cpu-roster-repair-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] cpu-roster-repair-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "cpu-roster-repair-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] cpu-roster-repair-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "CPU roster repair failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }
if (msg.type === "all-stars-result") {
  const entry = pending.get(msg.requestId);
  if (!entry) {
    console.warn("[simEnginePy] all-stars-result for unknown requestId", msg.requestId, msg);
    return;
  }
  pending.delete(msg.requestId);
  if (entry.timer) clearTimeout(entry.timer);
  entry.resolve(deepFromEntries(msg.payload));
  return;
}

    if (msg.type === "all-stars-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] all-stars-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "All-Star compute failed";
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
    // PLAYER PROGRESSION RESULT
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

      out = deepFromEntries(out);

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
    // PLAYER PROGRESSION ERROR
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

    // ------------------------------------------------------------
    // FREE AGENCY MARKET RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-market-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-market-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-market-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-market-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agency market generation failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // FREE AGENCY EVALUATE RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-eval-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-eval-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-eval-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-eval-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agency offer evaluation failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // FREE AGENCY SIGN RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-sign-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-sign-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-sign-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-sign-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agency signing failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // FREE AGENCY RELEASE RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-release-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-release-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-release-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-release-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agency release failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // OFFSEASON CONTRACT PREVIEW RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-preview-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-preview-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-preview-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-preview-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Offseason contract preview failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // OFFSEASON CONTRACT APPLY RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-apply-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-apply-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-apply-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-apply-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Offseason contract apply failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // PLAYER / TEAM OPTIONS PREVIEW RESULT
    // ------------------------------------------------------------
    if (msg.type === "player-team-options-preview-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] player-team-options-preview-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "player-team-options-preview-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] player-team-options-preview-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Player / Team options preview failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // PLAYER / TEAM OPTIONS APPLY RESULT
    // ------------------------------------------------------------
    if (msg.type === "player-team-options-apply-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] player-team-options-apply-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "player-team-options-apply-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] player-team-options-apply-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Player / Team options apply failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // FREE AGENCY INIT RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-init-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-init-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-init-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-init-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agency initialization failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // FREE AGENCY STATE SUMMARY RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-state-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-state-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-state-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-state-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agency state summary failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // FREE AGENT OFFERS RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-offers-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-offers-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-offers-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-offers-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Free agent offers load failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // SUBMIT USER OFFER RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-submit-offer-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-submit-offer-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-submit-offer-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-submit-offer-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Submit user free agent offer failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }

    // ------------------------------------------------------------
    // ADVANCE FREE AGENCY DAY RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-advance-day-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-advance-day-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-advance-day-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-advance-day-error for unknown requestId", msg.requestId, msg);
        return;
      }
      
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Advance free agency day failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }
        // ------------------------------------------------------------
    // PROCESS PENDING USER DECISIONS RESULT
    // ------------------------------------------------------------
    if (msg.type === "free-agency-process-pending-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-process-pending-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "free-agency-process-pending-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] free-agency-process-pending-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Process pending user free agency decisions failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
      return;
    }
    // ------------------------------------------------------------
    // PLAYER RETIREMENTS RESULT
    // ------------------------------------------------------------
    if (msg.type === "player-retirements-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] player-retirements-result for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(msg.payload);
      return;
    }

    if (msg.type === "player-retirements-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) {
        console.warn("[simEnginePy] player-retirements-error for unknown requestId", msg.requestId, msg);
        return;
      }
      pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      const err = msg.error || "Player retirement run failed";
      if (entry.reject) entry.reject(new Error(err));
      else entry.resolve({ ok: false, reason: err });
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
// PY -> JS converter
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
// PUBLIC API - SINGLE GAME (with timeout)
// ------------------------------------------------------------
const WORKER_TIMEOUT_MS = 300;
export function repairCpuTeamsToMinRoster(
  leagueData,
  userTeamName = null,
  minPlayers = 14,
  currentDay = 0
) {
  startWorker();

  const requestId = "FACR" + counter++;
  const TIMEOUT_MS = 60000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("CPU_ROSTER_REPAIR_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "repair-cpu-teams-to-min-roster",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
        minPlayers,
        currentDay,
      },
    });
  });
}
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
// PUBLIC API - BATCH GAME SCHEDULING
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
// PUBLIC API - SEASON AWARDS
// ------------------------------------------------------------

export function computeAllStars(payload = {}) {
  startWorker();

  const requestId = "AS" + counter++;
  const TIMEOUT_MS = 60000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("ALL_STARS_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "compute-all-stars",
      requestId,
      payload: deepSanitize(payload),
    });
  });
}
export function computeSeasonAwards(players, meta = {}) {
  startWorker();

  const requestId = "A" + counter++;

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
// PUBLIC API - FINALS MVP
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
// PUBLIC API - PLAYER PROGRESSION (Python)
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

// ------------------------------------------------------------
// PUBLIC API - FREE AGENCY MARKET
// ------------------------------------------------------------
export function generateFreeAgencyMarket(leagueData) {
  startWorker();

  const requestId = "FAM" + counter++;
  const TIMEOUT_MS = 12000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_MARKET_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "generate-free-agency-market",
      requestId,
      leagueData: deepSanitize(leagueData),
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - FREE AGENCY OFFER EVALUATION
// ------------------------------------------------------------
export function evaluateFreeAgencyOffer(leagueData, teamName, player, offer = {}) {
  startWorker();

  const requestId = "FAE" + counter++;
  const TIMEOUT_MS = 12000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_EVAL_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "evaluate-free-agent-offer",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        teamName,
        player: deepSanitize(player),
        offer: deepSanitize(offer),
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - SIGN FREE AGENT
// ------------------------------------------------------------
export function signFreeAgent(
  leagueData,
  teamName,
  playerId = null,
  playerName = null,
  offer = {}
) {
  startWorker();

  const requestId = "FAS" + counter++;
  const TIMEOUT_MS = 12000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_SIGN_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "sign-free-agent",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        teamName,
        playerId,
        playerName,
        offer: deepSanitize(offer),
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - RELEASE PLAYER TO FREE AGENCY
// ------------------------------------------------------------
export function releasePlayerToFreeAgency(
  leagueData,
  teamName,
  playerId = null,
  playerName = null
) {
  startWorker();

  const requestId = "FAR" + counter++;
  const TIMEOUT_MS = 12000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_RELEASE_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "release-player-free-agency",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        teamName,
        playerId,
        playerName,
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - OFFSEASON CONTRACT PREVIEW
// ------------------------------------------------------------
export function previewOffseasonContracts(leagueData, userTeamName = null) {
  startWorker();

  const requestId = "FAP" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_PREVIEW_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "preview-offseason-contracts",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - APPLY OFFSEASON CONTRACT DECISIONS
// ------------------------------------------------------------
export function applyOffseasonContractDecisions(
  leagueData,
  userTeamName = null,
  teamOptionDecisions = {}
) {
  startWorker();

  const requestId = "FAA" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_APPLY_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "apply-offseason-contract-decisions",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
        teamOptionDecisions: deepSanitize(teamOptionDecisions),
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - PLAYER / TEAM OPTIONS PREVIEW
// ------------------------------------------------------------
export function previewPlayerTeamOptions(leagueData, userTeamName = null) {
  startWorker();

  const requestId = "PTOP" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("PLAYER_TEAM_OPTIONS_PREVIEW_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "preview-player-team-options",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - PLAYER / TEAM OPTIONS APPLY
// ------------------------------------------------------------
export function applyPlayerTeamOptions(
  leagueData,
  userTeamName = null,
  teamOptionDecisions = {}
) {
  startWorker();

  const requestId = "PTOA" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("PLAYER_TEAM_OPTIONS_APPLY_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "apply-player-team-options",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
        teamOptionDecisions: deepSanitize(teamOptionDecisions),
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - INITIALIZE LIVE FREE AGENCY
// ------------------------------------------------------------
export function initializeFreeAgencyPeriod(
  leagueData,
  userTeamName = null,
  maxDays = 7
) {
  startWorker();

  const requestId = "FAI" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_INIT_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "initialize-free-agency-period",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
        maxDays,
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - FREE AGENCY STATE SUMMARY
// ------------------------------------------------------------
export function getFreeAgencyStateSummary(leagueData) {
  startWorker();

  const requestId = "FAST" + counter++;
  const TIMEOUT_MS = 12000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENCY_STATE_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "get-free-agency-state-summary",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {},
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - GET FREE AGENT OFFERS
// ------------------------------------------------------------
export function getFreeAgentOffers(
  leagueData,
  playerId = null,
  playerName = null
) {
  startWorker();

  const requestId = "FAO" + counter++;
  const TIMEOUT_MS = 12000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("FREE_AGENT_OFFERS_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "get-free-agent-offers",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        playerId,
        playerName,
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - SUBMIT USER FREE AGENT OFFER
// ------------------------------------------------------------
export function submitUserFreeAgentOffer(
  leagueData,
  teamName,
  playerId = null,
  playerName = null,
  offer = {}
) {
  startWorker();

  const requestId = "FAU" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("SUBMIT_USER_FREE_AGENT_OFFER_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "submit-user-free-agent-offer",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        teamName,
        playerId,
        playerName,
        offer: deepSanitize(offer),
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - ADVANCE FREE AGENCY DAY
// ------------------------------------------------------------
export function advanceFreeAgencyDay(
  leagueData,
  userTeamName = null
) {
  startWorker();

  const requestId = "FAD" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("ADVANCE_FREE_AGENCY_DAY_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "advance-free-agency-day",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
      },
    });
  });
}
export function processPendingUserFreeAgencyDecisions(
  leagueData,
  userTeamName = null,
  selectedPlayerKeys = []
) {
  startWorker();

  const requestId = "FAPD" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("PROCESS_PENDING_USER_FREE_AGENCY_DECISIONS_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "process-pending-user-free-agency-decisions",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        userTeamName,
        selectedPlayerKeys: deepSanitize(selectedPlayerKeys),
      },
    });
  });
}

// ------------------------------------------------------------
// PUBLIC API - PLAYER RETIREMENTS
// ------------------------------------------------------------
export function runPlayerRetirements(
  leagueData,
  statsByKey = {},
  settings = {},
  meta = {}
) {
  startWorker();

  const requestId = "RET" + counter++;
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("PLAYER_RETIREMENTS_TIMEOUT"));
    }, TIMEOUT_MS);

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
      type: "run-player-retirements",
      requestId,
      leagueData: deepSanitize(leagueData),
      payload: {
        statsByKey: deepSanitize(statsByKey),
        settings: deepSanitize(settings),
        seasonYear: meta?.seasonYear ?? null,
        seed: meta?.seed ?? null,
      },
    });
  });
}