/**
 * Read-only dedicated Python CPU-model adapter for League Intel.
 * Never calls the CPU generator, applies trades, writes a bank or saves state.
 * Its worker loads the ORIGINAL CPU Python code and reads preliminary boards.
 */
const teamName = (team) => team?.name || team?.teamName || "";
const allTeams = (league) => Array.isArray(league?.teams)
  ? league.teams
  : Object.values(league?.conferences || {}).flatMap((rows) => Array.isArray(rows) ? rows : []);

export function buildIntelCpuPythonPayload(leagueData, observation, userTeamName, lifecycle = null) {
  return {
    leagueData: {
      // cpu_cpu_trade_logic.py parses year labels first. Avoid stale named-league
      // labels silently overriding the authoritative salary season on year 10+.
      leagueName: lifecycle ? "" : leagueData?.leagueName,
      seasonYear: lifecycle?.payrollYear ?? leagueData?.seasonYear,
      currentSeasonYear: lifecycle?.payrollYear ?? leagueData?.currentSeasonYear,
      seasonStartYear: lifecycle?.payrollYear ?? leagueData?.seasonStartYear,
      teams: allTeams(leagueData).map((team) => ({
        name: teamName(team), phase: team?.phase, status: team?.status, direction: team?.direction,
        players: Array.isArray(team?.players) ? team.players : [],
      })),
      draftPicks: Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [],
      tradeHistory: Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [],
      currentDate: leagueData?.currentDate || leagueData?.seasonCurrentDate || "",
    },
    recordsByTeam: Object.fromEntries((observation?.teams || []).map((team) => [team.name, {
      wins: Number(team?.record?.wins || 0), losses: Number(team?.record?.losses || 0),
    }])),
    userTeamName: String(userTeamName || ""),
  };
}

/** A single reusable Python runtime for the Intel page, never a gameplay worker.
 * The expensive Pyodide initialization survives scouting-team switches and
 * React effect cleanup. Requests have unique ids; obsolete results are ignored.
 * A failed worker is discarded and the next request gets a fresh one.
 */
let sharedWorker = null;
let requestId = 0;
const inflight = new Map();

function discardSharedWorker(error = null) {
  const previous = sharedWorker;
  sharedWorker = null;
  try { previous?.terminate?.(); } catch {}
  for (const [id, entry] of inflight) {
    clearTimeout(entry.timeout);
    inflight.delete(id);
    if (error) entry.onError(error);
  }
}

function reuseWorker() {
  if (sharedWorker) return sharedWorker;
  const worker = new Worker("/workers/intelCpuReadOnlyWorker.js");
  worker.onmessage = (event) => {
    if (sharedWorker !== worker) return;
    const entry = inflight.get(event?.data?.id);
    if (!entry) return; // Discard old save/team/season replies.
    inflight.delete(event.data.id);
    clearTimeout(entry.timeout);
    if (event.data.ok) entry.onResult(event.data.value);
    else entry.onError(new Error(event.data.error || "CPU Python observer unavailable"));
  };
  worker.onerror = (error) => {
    if (sharedWorker === worker) discardSharedWorker(new Error(error?.message || "CPU Python worker failed"));
  };
  sharedWorker = worker;
  return worker;
}

export function startIntelCpuPythonProbe(payload, { onResult = () => {}, onError = () => {}, workerFactory = null } = {}) {
  let active = true;
  const id = `intel-readonly-profile-${++requestId}`;
  let worker;
  // Injected workers are isolated test instances; production uses shared.
  const isolated = Boolean(workerFactory);
  let timeout;
  const resolve = (value) => { if (active) onResult(value); };
  const reject = (error) => { if (active) onError(error); };
  try {
    worker = isolated ? workerFactory("/workers/intelCpuReadOnlyWorker.js") : reuseWorker();
    if (isolated) {
      worker.onmessage = (event) => {
        if (event?.data?.id !== id || !active) return;
        clearTimeout(timeout);
        if (event.data.ok) resolve(event.data.value);
        else reject(new Error(event.data.error || "CPU Python observer unavailable"));
      };
      worker.onerror = (error) => { clearTimeout(timeout); reject(new Error(error?.message || "CPU Python worker failed")); };
    }
    timeout = setTimeout(() => {
      if (!active) return;
      const err = new Error("CPU Python observer timed out. Saved evidence remains available.");
      if (!isolated) discardSharedWorker(err);
      else { reject(err); try { worker?.terminate?.(); } catch {} }
    }, 45000);
    if (!isolated) inflight.set(id, { onResult: resolve, onError: reject, timeout });
    worker.postMessage({ id, payload });
  } catch (error) {
    if (!isolated) { inflight.delete(id); clearTimeout(timeout); }
    reject(error);
  }
  return () => {
    active = false;
    clearTimeout(timeout);
    if (isolated) { try { worker?.terminate?.(); } catch {} }
    else inflight.delete(id); // Keep one idle runtime; no stale callback.
  };
}
