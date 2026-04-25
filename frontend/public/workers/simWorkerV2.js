// ============================================================
// simWorkerV2.js - Batch-safe Pyodide Simulation Worker
// ============================================================
console.log("[simWorkerV2] booting...");

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
  "progression.py",
  "free_agency_logic.py",
  "retirement_logic.py",
  "all_star_logic.py",
];

async function init() {
  if (ready) return;

  console.log("[simWorkerV2] loading Pyodide...");
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
      result: pyRes.toJs({ dict_converter: Object, create_pyproxies: false }),
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
      results: pyRes.toJs({ dict_converter: Object, create_pyproxies: false }),
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
// AWARDS MODE
// ------------------------------------------------------------
async function computeAwards(requestId, players, teams, seasonYear) {
  try {
    pyodide.globals.set("players_js", pyodide.toPy(players || []));
    pyodide.globals.set("teams_js", pyodide.toPy(teams || []));
    pyodide.globals.set("season_js", seasonYear ?? null);

    const pyRes = await pyodide.runPythonAsync(`
import importlib
import awards
importlib.reload(awards)
from awards import compute_awards
res = compute_awards(players_js, teams_js, season_js)
res
    `);

    const awardsOut = pyRes.toJs({ dict_converter: Object, create_pyproxies: false });

    postMessage({
      type: "awards-result",
      requestId,
      awards: awardsOut,
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
// FINALS MVP MODE
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

    const finalsMvp = pyRes.toJs({ dict_converter: Object, create_pyproxies: false });

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
async function computeAllStars(requestId, payload) {
  try {
    pyodide.globals.set("all_star_payload_js", pyodide.toPy(payload || {}));

    const pyRes = await pyodide.runPythonAsync(`
import importlib
import all_star_logic
importlib.reload(all_star_logic)
from all_star_logic import compute_all_stars

res = compute_all_stars(all_star_payload_js)
res
    `);

    const allStarsOut = pyRes.toJs({ dict_converter: Object, create_pyproxies: false });

    postMessage({
      type: "all-stars-result",
      requestId,
      payload: allStarsOut,
    });
  } catch (err) {
    console.error("[simWorkerV2] computeAllStars error:", err);
    postMessage({
      type: "all-stars-error",
      requestId,
      error: err.toString(),
    });
  }
}
// ------------------------------------------------------------
// PLAYER PROGRESSION MODE
// ------------------------------------------------------------
async function computeProgression(requestId, leagueData, statsByKey, meta) {
  try {
    pyodide.globals.set("league_js", pyodide.toPy(leagueData || {}));
    pyodide.globals.set("stats_js", pyodide.toPy(statsByKey || {}));
    pyodide.globals.set("meta_js", pyodide.toPy(meta || {}));

    const pyJson = await pyodide.runPythonAsync(`
import importlib, json
import progression
importlib.reload(progression)

from progression import apply_end_of_season_progression_with_deltas

seed = None
try:
  seed = meta_js.get("seed")
except Exception:
  seed = None

season_year = None
try:
  season_year = meta_js.get("seasonYear")
except Exception:
  season_year = None

res = apply_end_of_season_progression_with_deltas(
  league = league_js,
  stats_by_key = stats_js,
  settings = None,
  seed = seed,
  season_year = season_year
)

json.dumps(res)
    `);

    const payload = JSON.parse(pyJson);

    postMessage({
      type: "progression-result",
      requestId,
      payload,
    });
  } catch (err) {
    console.error("[simWorkerV2] computeProgression error:", err);
    postMessage({
      type: "progression-error",
      requestId,
      error: err.toString(),
    });
  }
}

// ------------------------------------------------------------
// FREE AGENCY GENERIC REQUEST MODE
// ------------------------------------------------------------
async function runFreeAgencyRequest(requestId, action, leagueData, payload, okType, errType) {
  try {
    pyodide.globals.set("fa_request_js", pyodide.toPy({
      action,
      leagueData: leagueData || {},
      payload: payload || {},
    }));

    const pyJson = await pyodide.runPythonAsync(`
import importlib, json
import free_agency_logic
importlib.reload(free_agency_logic)

from free_agency_logic import handle_request

res = handle_request(fa_request_js)
json.dumps(res)
    `);

    const payloadOut = JSON.parse(pyJson);

    postMessage({
      type: okType,
      requestId,
      payload: payloadOut,
    });
  } catch (err) {
    console.error("[simWorkerV2] free agency request error:", action, err);
    postMessage({
      type: errType,
      requestId,
      error: err.toString(),
    });
  }
}

async function generateFreeAgencyMarket(requestId, leagueData) {
  return runFreeAgencyRequest(
    requestId,
    "generate_market_for_all_free_agents",
    leagueData,
    {},
    "free-agency-market-result",
    "free-agency-market-error"
  );
}

async function evaluateFreeAgencyOffer(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "evaluate_offer",
    leagueData,
    payload || {},
    "free-agency-eval-result",
    "free-agency-eval-error"
  );
}

async function signFreeAgent(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "sign_free_agent",
    leagueData,
    payload || {},
    "free-agency-sign-result",
    "free-agency-sign-error"
  );
}

async function releasePlayerFreeAgency(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "release_player",
    leagueData,
    payload || {},
    "free-agency-release-result",
    "free-agency-release-error"
  );
}

async function previewOffseasonContracts(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "preview_offseason_contracts",
    leagueData,
    payload || {},
    "free-agency-preview-result",
    "free-agency-preview-error"
  );
}

async function applyOffseasonContractDecisions(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "apply_offseason_contract_decisions",
    leagueData,
    payload || {},
    "free-agency-apply-result",
    "free-agency-apply-error"
  );
}

async function previewPlayerTeamOptions(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "preview_player_team_options",
    leagueData,
    payload || {},
    "player-team-options-preview-result",
    "player-team-options-preview-error"
  );
}

async function applyPlayerTeamOptions(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "apply_player_team_options",
    leagueData,
    payload || {},
    "player-team-options-apply-result",
    "player-team-options-apply-error"
  );
}

async function initializeFreeAgencyPeriod(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "initialize_free_agency_period",
    leagueData,
    payload || {},
    "free-agency-init-result",
    "free-agency-init-error"
  );
}

async function getFreeAgencyStateSummary(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "get_free_agency_state_summary",
    leagueData,
    payload || {},
    "free-agency-state-result",
    "free-agency-state-error"
  );
}

async function getFreeAgentOffers(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "get_free_agent_offers",
    leagueData,
    payload || {},
    "free-agency-offers-result",
    "free-agency-offers-error"
  );
}

async function submitUserFreeAgentOffer(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "submit_user_free_agent_offer",
    leagueData,
    payload || {},
    "free-agency-submit-offer-result",
    "free-agency-submit-offer-error"
  );
}

async function advanceFreeAgencyDay(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "advance_free_agency_day",
    leagueData,
    payload || {},
    "free-agency-advance-day-result",
    "free-agency-advance-day-error"
  );
}
async function processPendingUserFreeAgencyDecisions(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "process_pending_user_decisions",
    leagueData,
    payload || {},
    "free-agency-process-pending-result",
    "free-agency-process-pending-error"
  );
}
async function repairCpuTeamsToMinRoster(requestId, leagueData, payload) {
  return runFreeAgencyRequest(
    requestId,
    "repair_cpu_teams_to_min_roster",
    leagueData,
    payload || {},
    "cpu-roster-repair-result",
    "cpu-roster-repair-error"
  );
}

// ------------------------------------------------------------
// PLAYER RETIREMENT GENERIC REQUEST MODE
// ------------------------------------------------------------
async function runRetirementRequest(requestId, leagueData, payload, okType, errType) {
  try {
    pyodide.globals.set("ret_request_js", pyodide.toPy({
      action: "run_player_retirements",
      leagueData: leagueData || {},
      payload: payload || {},
    }));

    const pyJson = await pyodide.runPythonAsync(`
import importlib, json
import retirement_logic
importlib.reload(retirement_logic)

from retirement_logic import handle_request

res = handle_request(ret_request_js)
json.dumps(res)
    `);

    const payloadOut = JSON.parse(pyJson);

    postMessage({
      type: okType,
      requestId,
      payload: payloadOut,
    });
  } catch (err) {
    console.error("[simWorkerV2] retirement request error:", err);
    postMessage({
      type: errType,
      requestId,
      error: err.toString(),
    });
  }
}

async function runPlayerRetirements(requestId, leagueData, payload) {
  return runRetirementRequest(
    requestId,
    leagueData,
    payload || {},
    "player-retirements-result",
    "player-retirements-error"
  );
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
    if (msg.type === "compute-all-stars") {
    return computeAllStars(msg.requestId, msg.payload || {});
  }
    if (msg.type === "repair-cpu-teams-to-min-roster") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return repairCpuTeamsToMinRoster(msg.requestId, leaguePayload, msg.payload || {});
  }

  if (msg.type === "simulate-batch") {
    return simulateBatch(msg.batchId, msg.games);
  }

  // awards
  if (msg.type === "compute-awards") {
    const seasonYear = msg.meta?.seasonYear ?? null;
    const teams = msg.teams || msg.meta?.teams || [];
    return computeAwards(msg.requestId, msg.players, teams, seasonYear);
  }

  // finals mvp
  if (msg.type === "compute-finals-mvp") {
    return computeFinalsMvp(msg.requestId, msg.players, msg.meta || {});
  }

  // progression
  if (msg.type === "compute-progression") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return computeProgression(
      msg.requestId,
      leaguePayload,
      msg.statsByKey,
      msg.meta || {}
    );
  }

  // free agency market
  if (msg.type === "generate-free-agency-market") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return generateFreeAgencyMarket(msg.requestId, leaguePayload);
  }

  // free agency evaluate
  if (msg.type === "evaluate-free-agent-offer") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return evaluateFreeAgencyOffer(msg.requestId, leaguePayload, msg.payload || {});
  }

  // free agency sign
  if (msg.type === "sign-free-agent") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return signFreeAgent(msg.requestId, leaguePayload, msg.payload || {});
  }

  // free agency release
  if (msg.type === "release-player-free-agency") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return releasePlayerFreeAgency(msg.requestId, leaguePayload, msg.payload || {});
  }

  // offseason contract preview
  if (msg.type === "preview-offseason-contracts") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return previewOffseasonContracts(msg.requestId, leaguePayload, msg.payload || {});
  }

  // offseason contract apply
  if (msg.type === "apply-offseason-contract-decisions") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return applyOffseasonContractDecisions(msg.requestId, leaguePayload, msg.payload || {});
  }

  // player / team options preview
  if (msg.type === "preview-player-team-options") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return previewPlayerTeamOptions(msg.requestId, leaguePayload, msg.payload || {});
  }

  // player / team options apply
  if (msg.type === "apply-player-team-options") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return applyPlayerTeamOptions(msg.requestId, leaguePayload, msg.payload || {});
  }

  // initialize live free agency
  if (msg.type === "initialize-free-agency-period") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return initializeFreeAgencyPeriod(msg.requestId, leaguePayload, msg.payload || {});
  }

  // free agency state summary
  if (msg.type === "get-free-agency-state-summary") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return getFreeAgencyStateSummary(msg.requestId, leaguePayload, msg.payload || {});
  }

  // view offers
  if (msg.type === "get-free-agent-offers") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return getFreeAgentOffers(msg.requestId, leaguePayload, msg.payload || {});
  }

  // submit user offer
  if (msg.type === "submit-user-free-agent-offer") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return submitUserFreeAgentOffer(msg.requestId, leaguePayload, msg.payload || {});
  }

  // advance free agency day
  if (msg.type === "advance-free-agency-day") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return advanceFreeAgencyDay(msg.requestId, leaguePayload, msg.payload || {});
  }
  if (msg.type === "process-pending-user-free-agency-decisions") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return processPendingUserFreeAgencyDecisions(msg.requestId, leaguePayload, msg.payload || {});
  }

  // player retirements
  if (msg.type === "run-player-retirements") {
    const leaguePayload = msg.leagueData ?? msg.league ?? {};
    return runPlayerRetirements(msg.requestId, leaguePayload, msg.payload || {});
  }
};