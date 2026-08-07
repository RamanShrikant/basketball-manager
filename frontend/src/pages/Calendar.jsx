import React, { useEffect, useMemo, useRef, useState } from "react";
import { ensureGameplansForLeague } from "../utils/ensureGameplans";
import { useGame } from "../context/GameContext";
import { getSeasonCalendarConfig, getSeasonStartYear } from "../utils/seasonContext.js";
import { writeLeagueClock } from "../utils/leagueClock.js";
import { getUserTradeRuleSettings, stampFreeAgentSigningRestrictions } from "../utils/userTradeRules.js";
import { useNavigate } from "react-router-dom";
import {
  simulateOneGame,
  computeSeasonAwards,
  computeAllStars,
  repairCpuTeamsToMinRoster,
  processCpuContractExtensions,
  closeContractExtensionWindow,
} from "@/api/simEnginePy";
import { cancelCpuTradeWorkerGeneration, getCpuCpuTradeCandidates, prewarmCpuTradeWorker } from "../api/cpuTradeEngine.js";
import { prewarmCpuTradeValidationPool } from "../api/cpuTradeValidationPool.js";
import {
  addGeneratedCpuTradeCandidates,
  buildCpuTradeBankSummary,
  buildCpuTradeWorkerContext,
  clearCpuTradeBankTestConfig,
  ensureCpuTradeBankState,
  executeDueCpuTradeFromBank,
  executePreparedCpuMegaTradePlan,
  prepareCpuMegaTradePlan,
  getCpuMegaTradeGenerationPolicy,
  getCpuTradeBankGenerationPolicy,
  getCpuTradeBankRunwayStatus,
  readCpuTradeBankTestConfig,
  writeCpuTradeBankTestConfig,
} from "../utils/cpuTradeBank.js";
import {
  TRADE_DESK_FEED_KEY,
  PLAYER_MOOD_EVENT_BUS_KEY,
  appendTradeDeskEntries,
  appendPlayerMoodEvents,
  appendTradeDeskMoodEventsFromEntries,
  buildRealisticGameMoodEvents,
  buildCompletedCpuTradeDeskEntry,
  syncTradeDeskFeedWithLeagueHistory,
} from "../utils/tradeDeskFeed.js";
import { queueSim } from "@/api/simQueue";
import LZString from "lz-string";
import { createPortal } from "react-dom";
import AllStars from "./AllStars";
import {
  saveBoxScoreToDB,
  saveBoxScoresBatchToDB,
  loadBoxScoreFromDB,
  loadBoxScoresByGameIdsFromDB,
  deleteBoxScoreFromDB,
  clearBoxScoresFromDB,
} from "../utils/indexedDbStorage";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import { saveLeagueData } from "../utils/leagueStorage.js";
import { archiveCurrentSeasonIntoPlayerCards } from "../utils/playerCareerHistory.js";
import { ensureCompletedSeasonStatsArchive } from "../utils/seasonStatsArchive.js";
import {
  enqueueCpuTradeLeagueSave,
  flushCpuTradeLeagueSaves,
} from "../utils/cpuTradeSaveQueue.js";
import useKeyboardTeamNavigation from "../utils/useKeyboardTeamNavigation.js";
import { getTeamAbbreviation } from "../utils/teamAbbreviations.js";
import { getDefaultDivisionForTeam, getDivisionConference, resolveTeamDivision } from "../utils/leagueDivisions.js";
import {
  applyGameToClutchStats,
  computeClutchAwardResults,
  createEmptyClutchStats,
  loadClutchStats,
  saveClutchStats,
  CLUTCH_STATS_KEY,
} from "../utils/clutchAwards.js";
import {
  evaluateTeamSimulationRoster,
} from "../utils/rosterRules.js";
import {
  findFirstPendingSimulationDate,
  getCpuTradeSimulationDateDecision,
  getCpuTradeCalendarPacingDecision,
  isCpuTradeWindowOpenDate,
} from "../utils/calendarCpuTradeTiming.js";
import {
  recordCpuTradeRepairDiagnostics,
  recordPreSimulationDiagnostics,
  recordSimulationPerformanceDiagnostics,
} from "../utils/bmDiagnostics.js";
import { buildCpuTradeDiagnosticReport, ensureCpuTradeDiagnosticsSession } from "../utils/cpuTradeDiagnostics.js";
import {
  cpuTradeNow,
  installCpuTradeTraceConsoleApi,
  isCpuTradeDeepTraceEnabled,
  recordCpuTradeBankHealth,
  recordCpuTradeCompleted,
  recordCpuTradeFeedWrite,
  recordCpuTradeGenerationJob,
  recordCpuTradePass,
  recordCpuTradeRepair,
  recordCpuTradeTiming,
  recordCpuTradeTrace,
  shouldDisableCpuTradesForDiagnostics,
  startCpuTradeMainThreadMonitor,
} from "../utils/cpuTradeTelemetry.js";
import { bumpPerfCounter } from "../utils/bmPerfRescueDebug.js";
import {
  ensureTeamGameplanInjurySafe,
  formatInjuryEventLine,
  normalizeInjurySettings,
  processGameInjuries,
  readInjurySafeGameplanMinutes,
  recoverPlayersForDate,
} from "../utils/injurySystem.js";

window.LZString = LZString;

const PENDING_SIM_INTENT_KEY = "bm_pending_calendar_sim_v1";

function readPendingSimulationIntent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_SIM_INTENT_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePendingSimulationIntent(intent) {
  if (!intent) {
    localStorage.removeItem(PENDING_SIM_INTENT_KEY);
    return null;
  }

  const next = { ...intent, updatedAt: Date.now() };
  localStorage.setItem(PENDING_SIM_INTENT_KEY, JSON.stringify(next));
  return next;
}

const MAX_SIMULATION_GAME_ORDER_EVENTS = 1400;
let simulationOrderRunSequence = 0;

function createSimulationOrderRunId(mode = "simulation", targetDate = "") {
  simulationOrderRunSequence += 1;
  return `${mode}_${targetDate || "season"}_${Date.now()}_${simulationOrderRunSequence}`;
}

function recordSimulationCheckpointEvent(simulationPerf, event = {}) {
  if (!simulationPerf) return null;
  if (!Array.isArray(simulationPerf.checkpointEvents)) simulationPerf.checkpointEvents = [];
  const row = {
    sequence: simulationPerf.checkpointEvents.length + 1,
    at: Date.now(),
    ...event,
  };
  simulationPerf.checkpointEvents.push(row);
  return row;
}

function startSimulationGameOrderEvent(simulationPerf, { scheduledDate = "", gameIndex = 0, game = null } = {}) {
  if (!simulationPerf || !game) return null;
  if (!Array.isArray(simulationPerf.gameExecutionOrder)) simulationPerf.gameExecutionOrder = [];

  const previous = simulationPerf.gameExecutionOrder[simulationPerf.gameExecutionOrder.length - 1] || null;
  const dateInversion = Boolean(
    previous?.scheduledDate &&
      scheduledDate &&
      String(scheduledDate) < String(previous.scheduledDate)
  );
  if (dateInversion) simulationPerf.gameOrderDateInversions += 1;

  simulationPerf.gameExecutionSequence = Number(simulationPerf.gameExecutionSequence || 0) + 1;
  const row = {
    sequence: simulationPerf.gameExecutionSequence,
    runId: simulationPerf.runId || "",
    scheduledDate,
    gameIndex,
    gameId: String(game?.id || ""),
    away: game?.away || "",
    home: game?.home || "",
    startedAt: Date.now(),
    status: "started",
    dateInversion,
    previousScheduledDate: previous?.scheduledDate || null,
    previousGameId: previous?.gameId || null,
  };

  simulationPerf.gameExecutionOrder.push(row);
  if (simulationPerf.gameExecutionOrder.length > MAX_SIMULATION_GAME_ORDER_EVENTS) {
    simulationPerf.gameExecutionOrder.splice(
      0,
      simulationPerf.gameExecutionOrder.length - MAX_SIMULATION_GAME_ORDER_EVENTS
    );
  }

  if (dateInversion) {
    console.error("[BM SIM ORDER] scheduled-date inversion detected", row);
  }
  return row;
}

function finishSimulationGameOrderEvent(row, status = "completed", details = null) {
  if (!row) return null;
  row.status = status;
  row.finishedAt = Date.now();
  row.elapsedMs = Math.max(0, row.finishedAt - Number(row.startedAt || row.finishedAt));
  if (details) row.details = details;
  return row;
}



/* -------------------------------------------------------------------------- */
/*                                ID UTILITIES                                */
/* -------------------------------------------------------------------------- */
function slugifyId(v) {
  if (!v) return "";
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
window.__slug = slugifyId;
function formatOTLabel(otCount) {
  const n = Number(otCount || 0);
  if (!n) return "";
  return n === 1 ? " (OT)" : ` (${n}OT)`;
}

function readSavedGameplan(teamName) {
  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readGameplanOrder(teamName, teamObj = null) {
  const saved = readSavedGameplan(teamName);
  const savedOrder = Array.isArray(saved?.order)
    ? saved.order.filter(Boolean)
    : [];

  const minutes =
    saved?.minutes && typeof saved.minutes === "object" && !Array.isArray(saved.minutes)
      ? saved.minutes
      : saved && typeof saved === "object"
      ? saved
      : {};

  const minuteOrder = Object.entries(minutes || {})
    .filter(([name]) => name)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([name]) => name);

  const rosterOrder = (teamObj?.players || [])
    .map((player) => player?.name || player?.player)
    .filter(Boolean);

  return Array.from(new Set([...savedOrder, ...minuteOrder, ...rosterOrder]));
}

function sortBoxRowsByFrozenRotation(rows = [], frozenOrder = [], fallbackOrder = []) {
  const order = Array.from(new Set([...(frozenOrder || []), ...(fallbackOrder || [])]));
  const index = new Map(order.map((name, i) => [String(name), i]));

  return [...(rows || [])].sort((a, b) => {
    const aName = String(a?.player || "");
    const bName = String(b?.player || "");
    const aIdx = index.has(aName) ? index.get(aName) : Number.MAX_SAFE_INTEGER;
    const bIdx = index.has(bName) ? index.get(bName) : Number.MAX_SAFE_INTEGER;
    if (aIdx !== bIdx) return aIdx - bIdx;

    const minDiff = Number(b?.min || 0) - Number(a?.min || 0);
    if (minDiff !== 0) return minDiff;
    return aName.localeCompare(bName);
  });
}

function readFlatMinutesFromGameplan(teamName) {
  const saved = readSavedGameplan(teamName);
  if (!saved) return {};

  if (
    saved.minutes &&
    typeof saved.minutes === "object" &&
    !Array.isArray(saved.minutes)
  ) {
    return { ...saved.minutes };
  }

  // backward compatibility with old flat format
  return { ...saved };
}

function buildRoleMapFromMinutes(minutesObj, orderedNames = null) {
  const names = Array.isArray(orderedNames) && orderedNames.length
    ? orderedNames.filter((name) => Number(minutesObj?.[name] || 0) > 0)
    : Object.entries(minutesObj || {})
        .filter(([, m]) => Number(m) > 0)
        .map(([name]) => name);

  const role = {};

  for (let i = 0; i < names.length; i++) {
    const nm = names[i];
    if (i < 5) role[nm] = "starter";
    else role[nm] = "bench";
  }

  if (names.length > 5) {
    role[names[5]] = "sixth_man";
  }

  return role;
}

function loadTeamRoleMap(teamName) {
  const saved = readSavedGameplan(teamName);
  if (!saved) return {};

  const minutesObj =
    saved.minutes &&
    typeof saved.minutes === "object" &&
    !Array.isArray(saved.minutes)
      ? saved.minutes
      : saved;

  const orderedNames = Array.isArray(saved.order) ? saved.order : null;

  return buildRoleMapFromMinutes(minutesObj, orderedNames);
}

function buildSimulationRuntime(leagueData, teams = []) {
  ensureGameplansForLeague(leagueData);
  const teamById = new Map();
  const teamByName = new Map();
  const minutesByTeam = new Map();
  const roleByTeam = new Map();
  const orderByTeam = new Map();

  for (const team of teams || []) {
    if (!team?.name) continue;
    teamById.set(slugifyId(team.name), team);
    teamByName.set(team.name, team);
    const minutes = readFlatMinutesFromGameplan(team.name);
    minutesByTeam.set(team.name, minutes);
    roleByTeam.set(team.name, loadTeamRoleMap(team.name));
    orderByTeam.set(team.name, readGameplanOrder(team.name, team));
  }

  return { leagueData, teams, teamById, teamByName, minutesByTeam, roleByTeam, orderByTeam };
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function getTeamPlayerCount(team) {
  return Array.isArray(team?.players)
    ? team.players.filter((p) => p && (p.name || p.player)).length
    : 0;
}

function getUserRosterSimBlockMessage(team) {
  if (!team) return "";
  return evaluateTeamSimulationRoster(team).message;
}

function getSimulationBlockMessageForGame(game, teams) {
  const homeTeam = teams.find((t) => slugifyId(t.name) === game?.homeId);
  const awayTeam = teams.find((t) => slugifyId(t.name) === game?.awayId);

  if (!homeTeam || !awayTeam) {
    return `Team lookup failed: ${game?.homeId} / ${game?.awayId}`;
  }

  const homeMessage = getUserRosterSimBlockMessage(homeTeam);
  if (homeMessage) return homeMessage;

  const awayMessage = getUserRosterSimBlockMessage(awayTeam);
  if (awayMessage) return awayMessage;

  return "";
}

function getSimulationBlockMessageThroughDate(scheduleByDate, teams, endDate = null) {
  const dates = Object.keys(scheduleByDate || {}).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  for (const d of dates) {
    if (endDate && d > endDate) break;

    for (const game of scheduleByDate?.[d] || []) {
      if (!game || game.played) continue;

      const msg = getSimulationBlockMessageForGame(game, teams);
      if (msg) return msg;
    }
  }

  return "";
}
/* -------------------------------------------------------------------------- */
/*                              SIMULATION WRAPPER                             */
/* -------------------------------------------------------------------------- */
async function simOneSafe(game, leagueData, teams, runtime = null, currentDate = null) {
  if (window.__debugSimLogs) {
    window.__lastGame = game;
    console.log("⏳ simOneSafe starting:", game.home, "vs", game.away);
  }

const activeRuntime = runtime || buildSimulationRuntime(leagueData, teams);
const homeSource = activeRuntime.teamById.get(game.homeId) || teams.find((t) => slugifyId(t.name) === game.homeId);
const awaySource = activeRuntime.teamById.get(game.awayId) || teams.find((t) => slugifyId(t.name) === game.awayId);

if (!homeSource || !awaySource) {
  throw new Error(`Team lookup failed: ${game.homeId} / ${game.awayId}`);
}

const simBlockMessage = getSimulationBlockMessageForGame(game, teams);
if (simBlockMessage) {
  throw new Error(simBlockMessage);
}

  const homeTeamObj = structuredClone(homeSource);
  const awayTeamObj = structuredClone(awaySource);

  for (const p of homeTeamObj.players || []) {
    if (!p.secondaryPos || String(p.secondaryPos).trim() === "") {
      p.secondaryPos = null;
    }
  }

  for (const p of awayTeamObj.players || []) {
    if (!p.secondaryPos || String(p.secondaryPos).trim() === "") {
      p.secondaryPos = null;
    }
  }

  ensureTeamGameplanInjurySafe(homeSource, currentDate);
  ensureTeamGameplanInjurySafe(awaySource, currentDate);
  homeTeamObj.minutes = readInjurySafeGameplanMinutes(homeSource, currentDate);
  awayTeamObj.minutes = readInjurySafeGameplanMinutes(awaySource, currentDate);

  if (window.__debugSimLogs) {
    console.log("[simOneSafe] home minutes keys =", Object.keys(homeTeamObj.minutes || {}));
    console.log("[simOneSafe] away minutes keys =", Object.keys(awayTeamObj.minutes || {}));
  }

  return await simulateOneGame({
    homeTeam: homeTeamObj,
    awayTeam: awayTeamObj,
    leagueData,
  });
}
// ---------------------------------------------------------------------------
// Helper: run ONE game with retries, using simOneSafe + queueSim
// ---------------------------------------------------------------------------
async function runGameWithRetries(game, leagueData, teams, maxRetries = 3, runtime = null, currentDate = null) {
  let lastFull = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (window.__debugSimLogs) {
      console.log(`[RetrySim] Game ${game.id} (${game.away} @ ${game.home}) attempt`, attempt, "of", maxRetries);
    }

    lastFull = await simOneSafe(game, leagueData, teams, runtime, currentDate);

    if (isBadFullResult(lastFull)) {
  window.__lastBad = {
    id: game.id,
    attempt,
    gotNull: lastFull === null,
    type: lastFull === null ? "null" : typeof lastFull,
    keys: lastFull && typeof lastFull === "object" ? Object.keys(lastFull) : null,
    score: lastFull?.score ?? null,
    boxKeys: lastFull && typeof lastFull === "object"
      ? ["box_home","box_away","boxHome","boxAway","home_box","away_box"].filter(k => k in lastFull)
      : null,
    raw: lastFull,
  };
  if (window.__debugSimLogs) console.log("[RetrySim] __lastBad saved to window.__lastBad");
}


    // good result?
    if (!isBadFullResult(lastFull)) {
      if (window.__debugSimLogs) console.log("[RetrySim] Success for game", game.id, "on attempt", attempt);
      return lastFull;
    }

    if (window.__debugSimLogs) {
      console.warn("[RetrySim] BAD result for game", game.id, "on attempt", attempt, lastFull);
    }
  }

  console.error(
    "[RetrySim] Permanent failure after",
    maxRetries,
    "attempts for game",
    game.id,
    lastFull
  );

  // keep a global list for debugging
  window.__failedGames = window.__failedGames || [];
  window.__failedGames.push({ id: game.id, game, lastFull });

  return null; // caller will decide what to do
}




/* -------------------------------------------------------------------------- */
/*                                 DATE UTILS                                 */
/* -------------------------------------------------------------------------- */
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const rangeDays = (start, end) => {
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    out.push(new Date(d));
  }
  return out;
};
const monthKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/* -------------------------------------------------------------------------- */
/*                                TEAM HELPERS                                */
/* -------------------------------------------------------------------------- */
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;

  if (leagueData.conferences) {
    return Object.values(leagueData.conferences).flat();
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/*                                TEAM LOGO UI                                */
/* -------------------------------------------------------------------------- */
const Logo = ({ team, size = 36 }) => {
  const src =
    team.logo ||
    team.teamLogo ||
    team.newTeamLogo ||
    team.image ||
    team.logoUrl;

  if (src) {
    return (
      <img
        src={src}
        alt={team.name}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          display: "block",
        }}
      />
    );
  }

  const initials = (team.name || "?")
    .split(" ")
    .map((w) => w[0]?.toUpperCase())
    .join("")
    .slice(0, 3);

  return (
    <div
      className="flex items-center justify-center rounded bg-neutral-700 text-white"
      style={{ width: size, height: size }}
    >
      <span className="text-sm font-bold">{initials}</span>
    </div>
  );
};
const MiniStandingsPanel = ({
  title,
  rows,
  selectedTeamName,
  hidden,
  onToggle,
  collapsedLabel,
  side,
  awardsEnabled = false,
  showAwards = false,
  onToggleAwards,
  awardTab = "mvp",
  awardRows = [],
  onPrevAward,
  onNextAward,
}) => {
  const sideClass = side === "left" ? "left-2" : "right-2";

  if (hidden) {
    return (
      <div className={`fixed top-32 ${sideClass} z-40`}>
        <button
          onClick={onToggle}
          className="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm font-semibold shadow-xl hover:bg-neutral-700"
        >
          {collapsedLabel}
        </button>
      </div>
    );
  }

  return (
    <div className={`group fixed top-24 ${sideClass} z-40 h-[min(74vh,720px)] w-44 xl:w-48`}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-white/60 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-700 bg-neutral-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-200">
              {showAwards ? "Awards" : title}
            </h3>

            {showAwards && (
              <div className="flex items-center gap-1 rounded bg-neutral-900/80 px-1 py-0.5">
                <button
                  onClick={onPrevAward}
                  className="px-1 text-xs text-gray-300 hover:text-orange-400"
                  title="Previous ladder"
                >
                  ◄
                </button>

                <span className="text-[11px] font-bold text-orange-400">
                  {MINI_AWARD_LABELS[awardTab] || "MVP"}
                </span>

                <button
                  onClick={onNextAward}
                  className="px-1 text-xs text-gray-300 hover:text-orange-400"
                  title="Next ladder"
                >
                  ►
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {awardsEnabled && (
              <button
                onClick={onToggleAwards}
                className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
              >
                {showAwards ? "Standings" : "Awards"}
              </button>
            )}

            <button
              onClick={onToggle}
              className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
            >
              Hide
            </button>
          </div>
        </div>

        {!showAwards ? (
          <div
            className="grid min-h-0 flex-1 overflow-hidden"
            style={{ gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))` }}
          >
            {rows.map((row, index) => (
              <div
                key={row.team}
                title={row.team}
                className={`flex min-h-0 items-center gap-2 border-b border-neutral-800 px-2 last:border-b-0 ${
                  selectedTeamName === row.team
                    ? "bg-orange-600/20"
                    : "hover:bg-neutral-800/70"
                }`}
              >
                <span className="w-4 shrink-0 text-[11px] text-gray-400">{index + 1}</span>
                <Logo team={{ name: row.team, logo: row.logo }} size={23} />

                <div className="flex min-w-0 items-center gap-1 text-[12px] font-semibold">
                  <span className="text-green-400">{row.w}</span>
                  <span className="text-gray-500">-</span>
                  <span className="text-red-400">{row.l}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="grid min-h-0 flex-1 overflow-hidden"
            style={{ gridTemplateRows: `repeat(${Math.max(awardRows.length, 1)}, minmax(0, 1fr))` }}
          >
            {!awardRows.length ? (
              <div className="flex items-center px-3 py-4 text-sm text-neutral-400">
                No ladder data yet.
              </div>
            ) : (
              awardRows.map((row, index) => (
                <div
                  key={`${awardTab}_${row.player}_${row.team}`}
                  className="flex min-h-0 items-center gap-1.5 border-b border-neutral-800 px-2 last:border-b-0 hover:bg-neutral-800/70"
                  title={`${index + 1}. ${row.player}`}
                >
                  <span className="w-4 shrink-0 text-[11px] text-gray-400">
                    {index + 1}
                  </span>

                  <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-neutral-700 bg-neutral-950">
                    {row.headshot ? (
                      <img
                        src={row.headshot}
                        alt={row.player}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="h-full w-full" />
                    )}
                  </div>

                  <div className="shrink-0">
                    <Logo team={{ name: row.team, logo: row.teamLogo }} size={16} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-gray-200">
                      {row.player}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};


/* -------------------------------------------------------------------------- */
/*                        DIVISION-AWARE SCHEDULE ENGINE                       */
/* -------------------------------------------------------------------------- */
function stableHashNumber(value = "") {
  let hash = 2166136261;
  for (const ch of String(value)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function resolveCalendarTeamMeta(teams = []) {
  const byCanon = {};
  const byConference = { East: [], West: [] };
  const byDivision = {};

  teams.forEach((t) => {
    const cid = slugifyId(t.name);
    const division = resolveTeamDivision(t, t.conference || t.conf || "");
    const conference = getDivisionConference(division) || t.conference || t.conf || "";
    const row = {
      id: cid,
      name: t.name,
      division,
      conference,
      logo: t.logo || t.teamLogo || t.logoUrl || t.image || t.img || t.newTeamLogo || "",
    };
    byCanon[cid] = row;
    if (!byConference[conference]) byConference[conference] = [];
    byConference[conference].push(row);
    if (!byDivision[division]) byDivision[division] = [];
    byDivision[division].push(row);
  });

  return { byCanon, byConference, byDivision };
}

function addSeriesGames(matchups, a, b, count, seedLabel = "", threeGameTwoHomeTeamId = null) {
  if (!a || !b || a.id === b.id) return;
  if (count === 4) {
    matchups.push({ home: a.id, away: b.id }, { home: b.id, away: a.id }, { home: a.id, away: b.id }, { home: b.id, away: a.id });
    return;
  }
  if (count === 2) {
    matchups.push({ home: a.id, away: b.id }, { home: b.id, away: a.id });
    return;
  }

  const aGetsTwoHome = threeGameTwoHomeTeamId
    ? a.id === threeGameTwoHomeTeamId
    : stableHashNumber(`${seedLabel}|${a.id}|${b.id}`) % 2 === 0;
  matchups.push(
    { home: aGetsTwoHome ? a.id : b.id, away: aGetsTwoHome ? b.id : a.id },
    { home: aGetsTwoHome ? b.id : a.id, away: aGetsTwoHome ? a.id : b.id },
    { home: aGetsTwoHome ? a.id : b.id, away: aGetsTwoHome ? b.id : a.id }
  );
}

function getExtraFourGamePairsForConference(confTeams = []) {
  const divisions = {};
  for (const team of confTeams) {
    if (!divisions[team.division]) divisions[team.division] = [];
    divisions[team.division].push(team);
  }
  const divisionRows = Object.values(divisions).map((rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name)));
  const extras = new Set();
  for (let i = 0; i < divisionRows.length; i += 1) {
    for (let j = i + 1; j < divisionRows.length; j += 1) {
      const aRows = divisionRows[i];
      const bRows = divisionRows[j];
      const limit = Math.min(aRows.length, bRows.length);
      for (let idx = 0; idx < limit; idx += 1) {
        for (let shift = 0; shift < Math.min(3, limit); shift += 1) {
          const a = aRows[idx];
          const b = bRows[(idx + shift) % limit];
          extras.add([a.id, b.id].sort().join("__"));
        }
      }
    }
  }
  return extras;
}

function buildDivisionAwareMatchups(teams = []) {
  const { byCanon, byConference } = resolveCalendarTeamMeta(teams);
  const ids = Object.keys(byCanon);
  const matchups = [];
  const extrasByConference = Object.fromEntries(
    Object.entries(byConference).map(([conference, rows]) => [conference, getExtraFourGamePairsForConference(rows)])
  );
  const threeGameTwoHomeCounts = Object.fromEntries(ids.map((id) => [id, 0]));

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = byCanon[ids[i]];
      const b = byCanon[ids[j]];
      if (!a || !b) continue;

      let count = 2;
      if (a.conference === b.conference) {
        if (a.division === b.division) {
          count = 4;
        } else {
          const extras = extrasByConference[a.conference] || new Set();
          const key = [a.id, b.id].sort().join("__");
          count = extras.has(key) ? 4 : 3;
        }
      }
      let twoHomeTeamId = null;
      if (count === 3) {
        const aCount = threeGameTwoHomeCounts[a.id] || 0;
        const bCount = threeGameTwoHomeCounts[b.id] || 0;
        if (aCount < 2 && bCount >= 2) twoHomeTeamId = a.id;
        else if (bCount < 2 && aCount >= 2) twoHomeTeamId = b.id;
        else twoHomeTeamId = stableHashNumber(`${a.id}|${b.id}|three-home`) % 2 === 0 ? a.id : b.id;
        threeGameTwoHomeCounts[twoHomeTeamId] = (threeGameTwoHomeCounts[twoHomeTeamId] || 0) + 1;
      }
      addSeriesGames(matchups, a, b, count, `${a.conference}|${a.division}|${b.division}`, twoHomeTeamId);
    }
  }

  return { matchups, byCanon };
}

function hasTeamGameOn(scheduleTeamDates, teamId, dateStr) {
  return Boolean(scheduleTeamDates?.[teamId]?.has(dateStr));
}

function violatesThreeStraight(scheduleTeamDates, teamId, dateStr) {
  const d = parseCalendarDate(dateStr);
  if (!d) return false;
  const prev1 = fmt(addDays(d, -1));
  const prev2 = fmt(addDays(d, -2));
  const next1 = fmt(addDays(d, 1));
  const next2 = fmt(addDays(d, 2));
  return (
    (hasTeamGameOn(scheduleTeamDates, teamId, prev1) && hasTeamGameOn(scheduleTeamDates, teamId, prev2)) ||
    (hasTeamGameOn(scheduleTeamDates, teamId, prev1) && hasTeamGameOn(scheduleTeamDates, teamId, next1)) ||
    (hasTeamGameOn(scheduleTeamDates, teamId, next1) && hasTeamGameOn(scheduleTeamDates, teamId, next2))
  );
}

function sortedPairKey(a, b) {
  return [String(a || ""), String(b || "")].sort().join("__");
}

function daysBetweenDateStrings(a, b) {
  const left = parseCalendarDate(a);
  const right = parseCalendarDate(b);
  if (!left || !right) return 0;
  return Math.round((right.getTime() - left.getTime()) / 86400000);
}

function spansAllowedAllStarBreak(a, b, allStarBreakSet) {
  const left = parseCalendarDate(a);
  const right = parseCalendarDate(b);
  if (!left || !right || !allStarBreakSet?.size) return false;
  for (const dateStr of allStarBreakSet) {
    const d = parseCalendarDate(dateStr);
    if (d && d > left && d < right) return true;
  }
  return false;
}

function buildCompactSeasonRoundDates(playableDays, neededRounds, allStarBreakSet) {
  if (!Array.isArray(playableDays) || neededRounds <= 0) return [];
  if (playableDays.length <= neededRounds) return playableDays.slice(0, neededRounds);

  let indexes = [];

  // The normal NBA rhythm is basically game, off day, game. When the number of
  // playable dates permits it, start from every-other-day slots, then inject a
  // few controlled back-to-back/two-day-rest pairs without ever creating long
  // dead zones outside the All-Star break.
  if (playableDays.length >= neededRounds * 2 - 1) {
    indexes = Array.from({ length: neededRounds }, (_, index) => index * 2);
  } else {
    const maxIndex = playableDays.length - 1;
    indexes = Array.from({ length: neededRounds }, (_, index) =>
      Math.round((index * maxIndex) / Math.max(1, neededRounds - 1))
    );
  }

  // De-dupe/fill defensive path for custom shortened seasons.
  const used = new Set();
  indexes = indexes.map((raw) => {
    let next = Math.max(0, Math.min(playableDays.length - 1, Number(raw) || 0));
    while (used.has(next) && next < playableDays.length - 1) next += 1;
    while (used.has(next) && next > 0) next -= 1;
    used.add(next);
    return next;
  }).sort((a, b) => a - b);

  while (indexes.length < neededRounds) {
    const existing = new Set(indexes);
    const next = playableDays.findIndex((_, index) => !existing.has(index));
    if (next < 0) break;
    indexes.push(next);
    indexes.sort((a, b) => a - b);
  }

  // Add occasional back-to-backs by moving the middle date in a three-date run
  // from x+2 to x+1. The following interval then becomes x+1 -> x+4, which is
  // exactly two off days. Skip the tweak if a trade-deadline/all-star removed
  // date would make the real calendar gap too large.
  for (let pivot = 8; pivot + 2 < indexes.length; pivot += 14) {
    const leftIndex = indexes[pivot];
    const rightIndex = indexes[pivot + 2];
    const shiftedMiddle = leftIndex + 1;
    if (shiftedMiddle >= rightIndex || shiftedMiddle >= playableDays.length) continue;
    if (indexes.includes(shiftedMiddle)) continue;

    const leftDate = playableDays[leftIndex];
    const middleDate = playableDays[shiftedMiddle];
    const rightDate = playableDays[rightIndex];
    const leftGap = daysBetweenDateStrings(leftDate, middleDate);
    const rightGap = daysBetweenDateStrings(middleDate, rightDate);
    const rightGapAllowed = rightGap <= 3 || spansAllowedAllStarBreak(middleDate, rightDate, allStarBreakSet);

    if (leftGap === 1 && rightGapAllowed) {
      indexes[pivot + 1] = shiftedMiddle;
    }
  }

  indexes = [...new Set(indexes)].sort((a, b) => a - b).slice(0, neededRounds);
  return indexes.map((index) => playableDays[index]).filter(Boolean);
}

function buildPairQueues(matchups = []) {
  const queues = {};
  for (const game of matchups) {
    const key = sortedPairKey(game.home, game.away);
    if (!queues[key]) queues[key] = [];
    queues[key].push(game);
  }
  return queues;
}

function buildRoundPairsFromQueues(pairQueues = {}, teamIds = [], neededRounds = 82) {
  // Build 82 full-league rounds from the 82-game NBA matchup graph. Each round
  // has every team playing once, which naturally creates the game/off/game rhythm
  // Raman wanted and removes random 4-6 day dead zones from the old greedy spread.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pairCounts = {};
    for (const [key, queue] of Object.entries(pairQueues)) {
      pairCounts[key] = Array.isArray(queue) ? queue.length : 0;
    }

    const lastOpponent = Object.fromEntries(teamIds.map((id) => [id, null]));
    const rounds = [];

    const remainingBetween = (a, b) => pairCounts[sortedPairKey(a, b)] || 0;
    const remainingDegreeWithin = (team, available) => {
      let total = 0;
      for (const other of available) {
        if (other !== team) total += remainingBetween(team, other);
      }
      return total;
    };

    const candidateCountWithin = (team, available) => {
      let count = 0;
      for (const other of available) {
        if (other !== team && remainingBetween(team, other) > 0) count += 1;
      }
      return count;
    };

    const findRound = (roundIndex) => {
      const available = new Set(teamIds);
      const pairs = [];
      const failedStates = new Set();

      const recurse = () => {
        if (available.size === 0) return true;

        const state = [...available].sort().join("|");
        if (failedStates.has(state)) return false;

        let team = null;
        let bestMeta = null;
        for (const candidate of available) {
          const possible = candidateCountWithin(candidate, available);
          const degree = remainingDegreeWithin(candidate, available);
          const meta = [possible, -degree, stableHashNumber(`${attempt}|${roundIndex}|pick|${candidate}`)];
          if (
            !bestMeta ||
            meta[0] < bestMeta[0] ||
            (meta[0] === bestMeta[0] && meta[1] < bestMeta[1]) ||
            (meta[0] === bestMeta[0] && meta[1] === bestMeta[1] && meta[2] < bestMeta[2])
          ) {
            team = candidate;
            bestMeta = meta;
          }
        }

        if (!team || bestMeta?.[0] <= 0) {
          failedStates.add(state);
          return false;
        }

        const opponents = [...available]
          .filter((other) => other !== team && remainingBetween(team, other) > 0)
          .sort((a, b) => {
            const remainingDiff = remainingBetween(team, b) - remainingBetween(team, a);
            if (remainingDiff) return remainingDiff;

            const repeatA = lastOpponent[team] === a || lastOpponent[a] === team ? 1 : 0;
            const repeatB = lastOpponent[team] === b || lastOpponent[b] === team ? 1 : 0;
            if (repeatA !== repeatB) return repeatA - repeatB;

            const degreeDiff = remainingDegreeWithin(b, available) - remainingDegreeWithin(a, available);
            if (degreeDiff) return degreeDiff;

            return stableHashNumber(`${attempt}|${roundIndex}|${team}|${a}`) - stableHashNumber(`${attempt}|${roundIndex}|${team}|${b}`);
          });

        available.delete(team);
        for (const opponent of opponents) {
          if (!available.has(opponent)) continue;
          available.delete(opponent);
          pairs.push([team, opponent]);

          if (recurse()) return true;

          pairs.pop();
          available.add(opponent);
        }
        available.add(team);

        failedStates.add(state);
        return false;
      };

      return recurse() ? pairs : null;
    };

    let ok = true;
    for (let roundIndex = 0; roundIndex < neededRounds; roundIndex += 1) {
      const pairs = findRound(roundIndex);
      if (!pairs) {
        ok = false;
        break;
      }

      for (const [a, b] of pairs) {
        const key = sortedPairKey(a, b);
        pairCounts[key] = (pairCounts[key] || 0) - 1;
        lastOpponent[a] = b;
        lastOpponent[b] = a;
      }
      rounds.push(pairs);
    }

    const remaining = Object.values(pairCounts).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
    if (ok && remaining === 0) return rounds;
  }

  return null;
}

function generateFullSeasonSchedule(teams, startDate, endDate, calendarConfig = null) {
  const canonicalIds = teams.map((t) => slugifyId(t.name));
  if (canonicalIds.length < 2) return { byDate: {}, list: [] };

  const { matchups, byCanon } = buildDivisionAwareMatchups(teams);
  const days = rangeDays(startDate, endDate);
  const byDate = {};
  for (const d of days) byDate[fmt(d)] = [];

  const gameStart =
    parseCalendarDate(calendarConfig?.regularSeasonGameStart) ||
    new Date(startDate.getFullYear(), 9, 21);
  const allStarDate = parseCalendarDate(calendarConfig?.allStarSelectionDate) || new Date(endDate.getFullYear(), 1, 15);
  const allStarStart = parseCalendarDate(calendarConfig?.allStarStart) || addDays(allStarDate, -5);
  const allStarEnd = parseCalendarDate(calendarConfig?.allStarEnd) || addDays(allStarDate, 3);
  const tradeDeadline = calendarConfig?.tradeDeadlineDate || fmt(new Date(endDate.getFullYear(), 1, 4));
  const extensionBlackoutDays = new Set([
    calendarConfig?.rookieExtensionDeadlineDate,
    calendarConfig?.contractExtensionDeadlineDate,
    calendarConfig?.veteranExtensionDeadlineDate,
  ].filter(Boolean));
  const allStarBreak = new Set(rangeDays(allStarStart, allStarEnd).map(fmt));

  const playableDays = days
    .filter((d) => d >= gameStart)
    .map(fmt)
    .filter((dateStr) => dateStr !== tradeDeadline && !extensionBlackoutDays.has(dateStr) && !allStarBreak.has(dateStr));

  const gamesPerFullRound = canonicalIds.length / 2;
  const neededRounds =
    canonicalIds.length % 2 === 0 && gamesPerFullRound > 0
      ? Math.round(matchups.length / gamesPerFullRound)
      : 0;

  const pairQueues = buildPairQueues(matchups);
  const rounds = neededRounds > 0
    ? buildRoundPairsFromQueues(pairQueues, canonicalIds, neededRounds)
    : null;
  const roundDates = buildCompactSeasonRoundDates(playableDays, neededRounds, allStarBreak);

  if (!rounds || roundDates.length < neededRounds) {
    console.warn("[Calendar] compact NBA schedule builder failed; using balanced fallback schedule.");
    return generateBalancedFallbackSchedule({
      teams,
      startDate,
      endDate,
      calendarConfig,
      matchups,
      byCanon,
      canonicalIds,
      playableDays,
      allStarBreak,
      tradeDeadline,
    });
  }

  rounds.forEach((pairs, roundIndex) => {
    const dateStr = roundDates[roundIndex];
    if (!dateStr) return;

    for (const [a, b] of pairs) {
      const key = sortedPairKey(a, b);
      const queued = pairQueues[key]?.shift();
      if (!queued) continue;

      const homeMeta = byCanon[queued.home];
      const awayMeta = byCanon[queued.away];
      if (!homeMeta || !awayMeta) continue;

      const roundGameIndex = byDate[dateStr].length;
      byDate[dateStr].push({
        id: `${dateStr}_${queued.away}_at_${queued.home}_${roundIndex}_${roundGameIndex}`,
        date: dateStr,
        homeId: queued.home,
        awayId: queued.away,
        home: homeMeta.name,
        away: awayMeta.name,
        homeLogo: homeMeta.logo,
        awayLogo: awayMeta.logo,
        homeTeamObj: homeMeta,
        awayTeamObj: awayMeta,
        confHome: homeMeta.conference,
        confAway: awayMeta.conference,
        divisionHome: homeMeta.division,
        divisionAway: awayMeta.division,
        played: false,
      });
    }
  });

  for (const dateStr of Object.keys(byDate)) {
    byDate[dateStr].sort((a, b) => String(a.away).localeCompare(String(b.away)) || String(a.home).localeCompare(String(b.home)));
  }

  return { byDate, list: Object.values(byDate).flat() };
}

function generateBalancedFallbackSchedule({
  teams,
  startDate,
  endDate,
  calendarConfig,
  matchups,
  byCanon,
  canonicalIds,
  playableDays,
  allStarBreak,
  tradeDeadline,
}) {
  const days = rangeDays(startDate, endDate);
  const byDate = {};
  for (const d of days) byDate[fmt(d)] = [];

  const dayLoad = Object.fromEntries(playableDays.map((dateStr) => [dateStr, 0]));
  const teamDates = Object.fromEntries(canonicalIds.map((id) => [id, new Set()]));
  const ordered = [...matchups].sort((a, b) => {
    const ha = stableHashNumber(`${a.home}|${a.away}`);
    const hb = stableHashNumber(`${b.home}|${b.away}`);
    return ha - hb;
  });
  const avgGamesPerDay = ordered.length / Math.max(1, playableDays.length);

  const pickDateForGame = (game, strict = true) => {
    let best = null;
    let bestScore = Infinity;
    for (let index = 0; index < playableDays.length; index += 1) {
      const dateStr = playableDays[index];
      if (hasTeamGameOn(teamDates, game.home, dateStr) || hasTeamGameOn(teamDates, game.away, dateStr)) continue;
      if (strict && (violatesThreeStraight(teamDates, game.home, dateStr) || violatesThreeStraight(teamDates, game.away, dateStr))) continue;
      const d = parseCalendarDate(dateStr);
      const restHomePrev = hasTeamGameOn(teamDates, game.home, fmt(addDays(d, -1))) ? 0 : 1;
      const restAwayPrev = hasTeamGameOn(teamDates, game.away, fmt(addDays(d, -1))) ? 0 : 1;
      const loadPenalty = Math.abs((dayLoad[dateStr] || 0) - avgGamesPerDay);
      const restMixBonus = restHomePrev === 0 || restAwayPrev === 0 ? -0.10 : 0;
      const score = loadPenalty * 2 + (dayLoad[dateStr] || 0) * 0.35 + restMixBonus + stableHashNumber(`${dateStr}|${game.home}|${game.away}`) / 1e12;
      if (score < bestScore) {
        bestScore = score;
        best = dateStr;
      }
    }
    return best;
  };

  ordered.forEach((game, gameIndex) => {
    let dateStr = pickDateForGame(game, true) || pickDateForGame(game, false) || playableDays[gameIndex % playableDays.length];
    if (!dateStr) return;
    const homeMeta = byCanon[game.home];
    const awayMeta = byCanon[game.away];
    const roundGameIndex = byDate[dateStr].length;
    byDate[dateStr].push({
      id: `${dateStr}_${game.away}_at_${game.home}_${gameIndex}_${roundGameIndex}`,
      date: dateStr,
      homeId: game.home,
      awayId: game.away,
      home: homeMeta.name,
      away: awayMeta.name,
      homeLogo: homeMeta.logo,
      awayLogo: awayMeta.logo,
      homeTeamObj: homeMeta,
      awayTeamObj: awayMeta,
      confHome: homeMeta.conference,
      confAway: awayMeta.conference,
      divisionHome: homeMeta.division,
      divisionAway: awayMeta.division,
      played: false,
    });
    dayLoad[dateStr] = (dayLoad[dateStr] || 0) + 1;
    teamDates[game.home].add(dateStr);
    teamDates[game.away].add(dateStr);
  });

  for (const dateStr of Object.keys(byDate)) {
    byDate[dateStr].sort((a, b) => String(a.away).localeCompare(String(b.away)) || String(a.home).localeCompare(String(b.home)));
  }

  return { byDate, list: Object.values(byDate).flat() };
}
/* -------------------------------------------------------------------------- */
/*                         SLIM RESULT (SAVED TO STORAGE)                     */
/* -------------------------------------------------------------------------- */
function slimResult(full) {
  if (!full) return null;

  const homeScore = full.score?.home ?? 0;
  const awayScore = full.score?.away ?? 0;

  const rawHomeBox =
    full.box_home ||
    full.boxHome ||
    full.home_box ||
    [];
  const rawAwayBox =
    full.box_away ||
    full.boxAway ||
    full.away_box ||
    [];

  const makePair = (m, a) => `${m || 0}-${a || 0}`;

  const toNumArray = (value) => {
    if (!value) return [];

    if (value instanceof Map) {
      return Array.from(value.values()).map((v) => Number(v) || 0);
    }

    if (Array.isArray(value)) {
      return value.map((v) => Number(v) || 0);
    }

    if (typeof value === "object") {
      return Object.values(value).map((v) => Number(v) || 0);
    }

    return [];
  };

  const sumNums = (arr) =>
    (arr || []).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const rawPeriods =
    full.periods ||
    full.lineScore ||
    full.linescore ||
    null;

  const quartersHome = toNumArray(
    full.quarters_home ||
      full.quartersHome ||
      full.home_quarters ||
      full.homeQuarters ||
      rawPeriods?.home ||
      rawPeriods?.Home
  );

  const quartersAway = toNumArray(
    full.quarters_away ||
      full.quartersAway ||
      full.away_quarters ||
      full.awayQuarters ||
      rawPeriods?.away ||
      rawPeriods?.Away
  );

  const explicitOtCount = Number(
    full.ot ??
      full.overtime ??
      full.otCount ??
      rawPeriods?.otCount ??
      rawPeriods?.ot ??
      0
  ) || 0;

  const inferredOtCount = Math.max(
    0,
    quartersHome.length - 4,
    quartersAway.length - 4
  );

  const rawOts = rawPeriods?.ots || rawPeriods?.otPeriods || {};
  const rawOtsHome = toNumArray(
    rawOts?.home ||
      rawOts?.Home ||
      rawPeriods?.ots_home ||
      rawPeriods?.otsHome ||
      quartersHome.slice(4)
  );
  const rawOtsAway = toNumArray(
    rawOts?.away ||
      rawOts?.Away ||
      rawPeriods?.ots_away ||
      rawPeriods?.otsAway ||
      quartersAway.slice(4)
  );

  const otCount = Math.max(
    explicitOtCount,
    inferredOtCount,
    rawOtsHome.length,
    rawOtsAway.length
  );

  const fillOts = (arr, count) =>
    Array.from({ length: count }, (_, idx) => Number(arr[idx] || 0));

  const hasRawIndividualOts = rawOtsHome.length > 0 || rawOtsAway.length > 0;
  const otsHome = hasRawIndividualOts ? fillOts(rawOtsHome, otCount) : [];
  const otsAway = hasRawIndividualOts ? fillOts(rawOtsAway, otCount) : [];

  const rawOtBreakdown = rawPeriods?.otBreakdown || {};
  const otHome = Number(
    rawOtBreakdown.home ??
      rawOtBreakdown.Home ??
      rawPeriods?.ot_home ??
      rawPeriods?.otHome ??
      sumNums(otsHome)
  ) || 0;

  const otAway = Number(
    rawOtBreakdown.away ??
      rawOtBreakdown.Away ??
      rawPeriods?.ot_away ??
      rawPeriods?.otAway ??
      sumNums(otsAway)
  ) || 0;

  const periods =
    quartersHome.length || quartersAway.length || rawPeriods
      ? {
          home: quartersHome.slice(0, 4),
          away: quartersAway.slice(0, 4),
          ots: {
            home: otsHome,
            away: otsAway,
          },
          otCount,
          otBreakdown: {
            home: otHome || undefined,
            away: otAway || undefined,
          },
        }
      : null;

  // 🔥 helper to pull makes/attempts from a variety of shapes
  function extractMA(obj, keysM, keysA, stringKeys = []) {
    let m, a;

    // numeric-style keys
    for (const k of keysM) {
      if (obj[k] != null) {
        m = Number(obj[k]) || 0;
        break;
      }
    }
    for (const k of keysA) {
      if (obj[k] != null) {
        a = Number(obj[k]) || 0;
        break;
      }
    }

    // string-style key like "11-22" or "11/22"
    if ((m == null || a == null) && stringKeys.length) {
      for (const sk of stringKeys) {
        const raw = obj[sk];
        if (!raw) continue;
        const str = String(raw).trim();
        if (!str) continue;

        const parts = str.split(/[\/-]/).map((x) => parseInt(x.trim(), 10) || 0);
        if (parts.length >= 2) {
          if (m == null) m = parts[0];
          if (a == null) a = parts[1];
          break;
        }
      }
    }

    return {
      m: m || 0,
      a: a || 0,
    };
  }

  const convertBox = (arr) =>
    (arr || []).map((p) => {
      const obj = p instanceof Map ? Object.fromEntries(p) : p;

      // 🔥 FG
      const fg = extractMA(
        obj,
        ["fgm", "fg_m"],
        ["fga", "fg_a"],
        ["fg"]
      );

      // 🔥 3P
      const tp = extractMA(
        obj,
        ["tpm", "tp_m", "fg3m", "three_m"],
        ["tpa", "tp_a", "fg3a", "three_a"],
        ["3p", "tp", "three"]
      );

      // 🔥 FT
      const ft = extractMA(
        obj,
        ["ftm", "ft_m"],
        ["fta", "ft_a"],
        ["ft"]
      );

      const fgStr = makePair(fg.m, fg.a);
      const threeStr = makePair(tp.m, tp.a);
      const ftStr = makePair(ft.m, ft.a);

      return {
        player: obj.player ?? obj.player_name ?? obj.name ?? "Unknown",
        min: obj.min ?? obj.minutes ?? 0,
        pts: obj.pts ?? obj.points ?? 0,
        reb: obj.reb ?? obj.rebounds ?? 0,
        ast: obj.ast ?? obj.assists ?? 0,
        stl: obj.stl ?? obj.steals ?? 0,
        blk: obj.blk ?? obj.blocks ?? 0,
        fg: fgStr,
        "3p": threeStr,
        ft: ftStr,
        to: obj.to ?? obj.turnovers ?? 0,
        pf: obj.pf ?? obj.fouls ?? 0,
      };
    });

const side =
    homeScore > awayScore ? "home" :
    awayScore > homeScore ? "away" :
    "tie";


  const boxHome = convertBox(rawHomeBox);
  const boxAway = convertBox(rawAwayBox);

  if ((boxHome.length === 0 || boxAway.length === 0) && (homeScore || awayScore)) {
    console.warn("⚠ slimResult: empty box with non-zero score", {
      homeScore,
      awayScore,
      rawHomeBox,
      rawAwayBox,
    });
  }

  return {
    winner: {
      score: `${homeScore}-${awayScore}`,
      home: homeScore,
      away: awayScore,
      ot: otCount,
      side,
    },
    totals: {
      home: homeScore,
      away: awayScore,
    },
    periods,
    box: {
      home: boxHome,
      away: boxAway,
    },
  };
}




/* -------------------------------------------------------------------------- */
/*                  BAD RESULT / GHOST GAME DETECTION HELPERS                 */
/* -------------------------------------------------------------------------- */

// works on the *full* Python result from simEnginePy
function pairsToObj(x) {
  if (!x) return x;
  if (x instanceof Map) return Object.fromEntries(x);
  if (Array.isArray(x) && x.length && Array.isArray(x[0]) && x[0].length === 2) {
    return Object.fromEntries(x);
  }
  return x;
}

function isBadFullResult(full) {
  if (!full) return true;
  if (full.error) return true;

  const score = pairsToObj(full.score);
  if (!score) return true;

  const home = Number(score.home ?? score.Home ?? 0) || 0;
  const away = Number(score.away ?? score.Away ?? 0) || 0;

  const homeBox =
    full.box_home ||
    full.boxHome ||
    full.home_box ||
    (full.box && (full.box.home || full.box.Home)) ||
    [];

  const awayBox =
    full.box_away ||
    full.boxAway ||
    full.away_box ||
    (full.box && (full.box.away || full.box.Away)) ||
    [];

  const noBox = (!homeBox || homeBox.length === 0) && (!awayBox || awayBox.length === 0);

  // “ghost” signature
  return home === 0 && away === 0 && noBox;
}


// works on the *slim* results object and schedule
function cleanupGhostGames(sched, results) {
  const badIds = Object.entries(results)
    .filter(([id, r]) => {
      if (!r) return true;
      if (r.error) return true;

      const totals = r.totals || {};
      const box = r.box || {};
      const zeroTotals =
        (totals.home ?? 0) === 0 &&
        (totals.away ?? 0) === 0 &&
        box &&
        (!box.home || box.home.length === 0) &&
        (!box.away || box.away.length === 0);

      return zeroTotals;
    })
    .map(([id]) => id);

  if (!badIds.length) {
    console.log("[Calendar] cleanupGhostGames: no ghosts to clean");
    return;
  }

  console.warn(
    "[Calendar] cleanupGhostGames: removing",
    badIds.length,
    "ghost result(s)",
    badIds
  );

  for (const badId of badIds) {
    delete results[badId];
    deleteOneResultV3(badId);


    for (const games of Object.values(sched)) {
      const g = games.find((gg) => gg.id === badId);
      if (g) {
        g.played = false;
        break;
      }
    }
  }
}
function normalizeAwards(raw) {
  if (!raw) return null;

  // Python gives us an array of [key, value] pairs
  if (!Array.isArray(raw)) return raw; // already a plain object

  const outer = Object.fromEntries(raw);

  const asObj = (x) => {
    if (!x) return null;
    if (Array.isArray(x)) return Object.fromEntries(x);
    return x;
  };

  return {
    season: outer.season,
    mvp: asObj(outer.mvp),
    dpoy: asObj(outer.dpoy),
    roty: asObj(outer.roty),
    sixth_man: asObj(outer.sixth_man),
  };
}

// ------------------------------------------------------------
// AWARDS: derive team wins from schedule + saved results
// (because leagueData does NOT store wins)
// ------------------------------------------------------------
function buildTeamsWithWinsForAwards(allTeams, scheduleByDate, resultsById) {
  const wins = {};
  const gamesPlayed = {};

  const bumpWin = (teamName) => {
    if (!teamName) return;
    wins[teamName] = (wins[teamName] || 0) + 1;
  };

  const bumpGame = (teamName) => {
    if (!teamName) return;
    gamesPlayed[teamName] = (gamesPlayed[teamName] || 0) + 1;
  };

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      if (!g?.played) continue;

      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      bumpGame(g.home);
      bumpGame(g.away);

      const homePts = Number(r.totals.home ?? 0);
      const awayPts = Number(r.totals.away ?? 0);

      // ignore ties
      if (homePts === awayPts) continue;

      if (homePts > awayPts) bumpWin(g.home);
      else bumpWin(g.away);
    }
  }

  // Return a list that awards.py can consume and the live ladders can use for 80% GP checks.
  return (allTeams || []).map((t) => ({
    team: t?.name,     // IMPORTANT: must match playerStats.team (your schedule uses team names)
    wins: wins[t?.name] || 0,
    games: gamesPlayed[t?.name] || 0,
  }));
}
const MINI_AWARD_TABS = ["mvp", "dpoy", "sixth_man"];
const MINI_AWARD_LABELS = {
  mvp: "MVP",
  dpoy: "DPOY",
  sixth_man: "6MOY",
};

const MINI_AWARD_LIMIT = 10;
const MINI_AWARD_MIN_GAME_SHARE = 0.8;

function awardStatsKey(player, team) {
  return `${player}__${team}`;
}

function combineAwardStatsForPlayer(statsMap, playerName, currentTeamName = "") {
  const name = String(playerName || "").trim();
  if (!name) return null;

  const records = Object.entries(statsMap || {})
    .filter(([key, row]) => {
      if (row?._awardsOnly || row?._combinedForAwards) return false;
      return (row?.player || key.split("__")[0]) === name && Number(row?.gp || 0) > 0;
    })
    .map(([, row]) => row);

  if (!records.length) return null;

  const total = {
    player: name,
    team: currentTeamName || records[records.length - 1]?.team || "",
    gp: 0,
    min: 0,
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    to: 0,
    pf: 0,
    started: 0,
    sixth: 0,
    _hasRoleData: false,
  };

  for (const row of records) {
    total.gp += Number(row.gp || 0);
    total.min += Number(row.min || 0);
    total.pts += Number(row.pts || 0);
    total.reb += Number(row.reb || 0);
    total.ast += Number(row.ast || 0);
    total.stl += Number(row.stl || 0);
    total.blk += Number(row.blk || 0);
    total.fgm += Number(row.fgm || 0);
    total.fga += Number(row.fga || 0);
    total.tpm += Number(row.tpm || 0);
    total.tpa += Number(row.tpa || 0);
    total.ftm += Number(row.ftm || 0);
    total.fta += Number(row.fta || 0);
    total.to += Number(row.to ?? row.tov ?? row.turnovers ?? 0);
    total.pf += Number(row.pf ?? row.fouls ?? 0);
    total.started += Number(row.started || 0);
    total.sixth += Number(row.sixth || 0);
    total._hasRoleData = total._hasRoleData || Object.prototype.hasOwnProperty.call(row, "started") || Object.prototype.hasOwnProperty.call(row, "sixth");
  }

  return total;
}

function buildCombinedAwardStatsForCurrentRosters(statsMap, allTeams) {
  const out = {};
  for (const team of allTeams || []) {
    const teamName = team?.name || team?.team;
    if (!teamName) continue;

    for (const player of team?.players || []) {
      const playerName = player?.name || player?.player;
      if (!playerName) continue;

      const combined = combineAwardStatsForPlayer(statsMap, playerName, teamName);
      if (combined && Number(combined.gp || 0) > 0) {
        out[awardStatsKey(playerName, teamName)] = combined;
      }
    }
  }
  return out;
}

function miniPerGame(total, gp) {
  const games = Number(gp || 0);
  return games > 0 ? Number(total || 0) / games : 0;
}

function miniPpg(p) {
  return miniPerGame(p.pts, p.gp);
}

function miniApg(p) {
  return miniPerGame(p.ast, p.gp);
}

function miniRpg(p) {
  return miniPerGame(p.reb, p.gp);
}

function miniSpg(p) {
  return miniPerGame(p.stl, p.gp);
}

function miniBpg(p) {
  return miniPerGame(p.blk, p.gp);
}

function miniMpg(p) {
  return miniPerGame(p.min, p.gp);
}

function miniBenchGames(p) {
  const gp = Number(p.gp || 0);
  const starts = Number(p.started || 0);
  const explicitBench = Number(p.sixth || 0);
  if (p._hasRoleData || starts > 0 || explicitBench > 0) {
    return Math.max(0, gp - starts);
  }
  return Math.max(0, explicitBench);
}

function miniRequiredTrackerGames(teamGames) {
  const games = Number(teamGames || 0);
  if (games <= 0) return 1;
  return Math.max(1, Math.ceil(games * MINI_AWARD_MIN_GAME_SHARE));
}

function miniHasTrackerGames(p) {
  const teamGames = Number(p._team_games || p.gp || 0);
  return Number(p.gp || 0) >= miniRequiredTrackerGames(teamGames);
}

function miniNorm(v, vmax) {
  if (vmax <= 0) return 0;
  return Math.max(0, Math.min(1, v / vmax));
}

function miniNormDef(v, lo, hi) {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (hi - v) / (hi - lo)));
}

function buildMiniAwardContext(players) {
  if (!players.length) {
    return {
      ppg: 1,
      apg: 1,
      rpg: 1,
      spg: 1,
      bpg: 1,
      wins: 82,
      defLo: 90,
      defHi: 120,
    };
  }

  return {
    ppg: Math.max(...players.map((p) => miniPpg(p)), 1),
    apg: Math.max(...players.map((p) => miniApg(p)), 1),
    rpg: Math.max(...players.map((p) => miniRpg(p)), 1),
    spg: Math.max(...players.map((p) => miniSpg(p)), 1),
    bpg: Math.max(...players.map((p) => miniBpg(p)), 1),
    wins: Math.max(...players.map((p) => Number(p._team_wins || 0)), 1),
    defLo: Math.min(...players.map((p) => Number(p.def_rating ?? 110))),
    defHi: Math.max(...players.map((p) => Number(p.def_rating ?? 110))),
  };
}

function calcMiniMvpScore(p, c) {
  return (
    0.30 * miniNorm(miniPpg(p), c.ppg) +
    0.15 * miniNorm(miniApg(p), c.apg) +
    0.15 * miniNorm(miniRpg(p), c.rpg) +
    0.20 * miniNorm(Number(p._team_wins || 0), c.wins) +
    0.075 * miniNorm(miniSpg(p), c.spg) +
    0.075 * miniNorm(miniBpg(p), c.bpg) +
    0.05 * miniNormDef(Number(p.def_rating ?? c.defHi), c.defLo, c.defHi)
  );
}

function calcMiniDpoyScore(p, c) {
  return (
    0.35 * miniNorm(miniSpg(p), c.spg) +
    0.35 * miniNorm(miniBpg(p), c.bpg) +
    0.20 * miniNormDef(Number(p.def_rating ?? c.defHi), c.defLo, c.defHi) +
    0.10 * miniNorm(Number(p._team_wins || 0), c.wins)
  );
}

function calcMiniSixthManScore(p, c) {
  return (
    0.35 * miniNorm(miniPpg(p), c.ppg) +
    0.20 * miniNorm(miniApg(p), c.apg) +
    0.20 * miniNorm(miniRpg(p), c.rpg) +
    0.10 * miniNorm(miniSpg(p), c.spg) +
    0.10 * miniNorm(miniBpg(p), c.bpg) +
    0.05 * miniNormDef(Number(p.def_rating ?? c.defHi), c.defLo, c.defHi)
  );
}

function isMiniSixthManEligible(p) {
  const starts = Number(p.started || 0);
  return miniMpg(p) >= 14 && miniBenchGames(p) > starts;
}

function buildMiniRosterInfoIndex(allTeams) {
  const map = {};

  for (const t of allTeams || []) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    const teamLogo =
      t.logo ||
      t.teamLogo ||
      t.newTeamLogo ||
      t.logoUrl ||
      t.image ||
      t.img ||
      null;

    for (const pl of t?.players || []) {
      const playerName = pl?.name || pl?.player;
      if (!playerName) continue;

      map[awardStatsKey(playerName, teamName)] = {
        headshot:
          pl?.portrait ||
          pl?.image ||
          pl?.photo ||
          pl?.headshot ||
          pl?.img ||
          pl?.face ||
          null,
        teamLogo,
        def_rating:
          pl?.def_rating ??
          pl?.defRating ??
          pl?.defensive_rating ??
          pl?.defensiveRating ??
          pl?.drtg ??
          pl?.defrtg ??
          110,
      };
    }
  }

  return map;
}

function toMiniAwardRow(p, score) {
  return {
    player: p.player,
    team: p.team,
    headshot: p.headshot || null,
    teamLogo: p.teamLogo || null,
    _score: score,
  };
}

function buildMiniAwardLadders(allTeams, statsMap, scheduleByDate, resultsById) {
  const rosterInfoIndex = buildMiniRosterInfoIndex(allTeams);

  const teamWinsRows = buildTeamsWithWinsForAwards(
    allTeams,
    scheduleByDate,
    resultsById
  );

  const teamWinsMap = {};
  const teamGamesMap = {};
  for (const t of teamWinsRows) {
    teamWinsMap[t.team] = Number(t.wins || 0);
    teamGamesMap[t.team] = Number(t.games || 0);
  }

  for (const row of Object.values(statsMap || {})) {
    const teamName = row?.team;
    if (!teamName) continue;
    teamGamesMap[teamName] = Math.max(Number(teamGamesMap[teamName] || 0), Number(row.gp || 0));
  }

  const playerPool = [];
  const combinedStatsByCurrentRoster = buildCombinedAwardStatsForCurrentRosters(statsMap, allTeams);

  for (const t of allTeams || []) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    for (const pl of t?.players || []) {
      const playerName = pl?.name || pl?.player;
      if (!playerName) continue;

      const key = awardStatsKey(playerName, teamName);
      const s = combinedStatsByCurrentRoster[key];
      if (!s || Number(s.gp || 0) <= 0) continue;

      const info = rosterInfoIndex[key] || {};

      playerPool.push({
        player: playerName,
        team: teamName,
        gp: Number(s.gp || 0),
        min: Number(s.min || 0),
        pts: Number(s.pts || 0),
        reb: Number(s.reb || 0),
        ast: Number(s.ast || 0),
        stl: Number(s.stl || 0),
        blk: Number(s.blk || 0),
        started: Number(s.started || 0),
        sixth: Number(s.sixth || 0),
        _hasRoleData: Boolean(s._hasRoleData) || Object.prototype.hasOwnProperty.call(s, "started") || Object.prototype.hasOwnProperty.call(s, "sixth"),
        def_rating: Number(info.def_rating ?? 110),
        headshot: info.headshot || null,
        teamLogo: info.teamLogo || null,
        _team_wins: Number(teamWinsMap[teamName] || 0),
        _team_games: Math.max(Number(teamGamesMap[teamName] || 0), Number(s.gp || 0)),
      });
    }
  }

  if (!playerPool.length) {
    return {
      mvp: [],
      dpoy: [],
      sixth_man: [],
    };
  }

  const eligiblePool = playerPool.filter((p) => miniHasTrackerGames(p));

  const basePool = eligiblePool;
  const baseCtx = buildMiniAwardContext(basePool);

  const mvp = basePool
    .map((p) => toMiniAwardRow(p, calcMiniMvpScore(p, baseCtx)))
    .sort((a, b) => b._score - a._score)
    .slice(0, MINI_AWARD_LIMIT);

  const dpoy = basePool
    .map((p) => toMiniAwardRow(p, calcMiniDpoyScore(p, baseCtx)))
    .sort((a, b) => b._score - a._score)
    .slice(0, MINI_AWARD_LIMIT);

  const sixthPool = basePool.filter((p) => isMiniSixthManEligible(p));
  const sixthCtx = buildMiniAwardContext(sixthPool.length ? sixthPool : basePool);

  const sixth_man = (sixthPool.length ? sixthPool : [])
    .map((p) => toMiniAwardRow(p, calcMiniSixthManScore(p, sixthCtx)))
    .sort((a, b) => b._score - a._score)
    .slice(0, MINI_AWARD_LIMIT);

  return {
    mvp,
    dpoy,
    sixth_man,
  };
}
// ------------------------------------------------------------
// AWARDS: attach def_rating to player season stat objects
// by looking it up from leagueData rosters
// ------------------------------------------------------------
function buildDefRatingLookupFromLeague(allTeams) {
  const map = {}; // key: "Player Name__Team Name" -> def_rating

  for (const t of (allTeams || [])) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    for (const pl of (t.players || [])) {
      const playerName = pl?.player || pl?.name;
      if (!playerName) continue;

      // try common keys (add more if your roster uses a different name)
      const def =
        pl.def_rating ??
        pl.defRating ??
        pl.defensive_rating ??
        pl.defensiveRating ??
        pl.drtg ??
        pl.defrtg;

      if (def != null && Number.isFinite(Number(def))) {
        map[`${playerName}__${teamName}`] = Number(def);
      }
    }
  }

  return map;
}


// ------------------------------------------------------------
// AWARDS: attach rookie eligibility metadata to player stat objects
// by looking it up from leagueData rosters
// ------------------------------------------------------------
function safeAwardNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function weightedAwardAverage(total, games) {
  return games > 0 ? total / games : 0;
}

function combineAwardSeasonRows(rows) {
  const clean = (rows || []).filter((row) => row && row.rowType !== "total");
  const games = clean.reduce((sum, row) => sum + safeAwardNumber(row.games ?? row.gp), 0);
  const safeGames = games || 1;

  const weighted = (key) =>
    weightedAwardAverage(
      clean.reduce((sum, row) => {
        const rowGames = safeAwardNumber(row.games ?? row.gp);
        return sum + safeAwardNumber(row[key]) * rowGames;
      }, 0),
      safeGames
    );

  const latest = [...clean].reverse().find(Boolean) || {};

  return {
    seasonYear: latest.seasonYear,
    teamName: clean.length > 1 ? "Total" : latest.teamName,
    teamLogo: clean.length > 1 ? "" : latest.teamLogo,
    rowType: clean.length > 1 ? "total" : latest.rowType || "team",
    games,
    ppg: weighted("ppg"),
    rpg: weighted("rpg"),
    apg: weighted("apg"),
    spg: weighted("spg"),
    bpg: weighted("bpg"),
    fgPct: weighted("fgPct"),
    threePct: weighted("threePct"),
    ftPct: weighted("ftPct"),
  };
}

function awardHistoryRowHasRealNbaActivity(row) {
  if (!row || row.rowType === "total") return false;
  const games = safeAwardNumber(row.games ?? row.gp, 0);
  if (games <= 0) return false;

  const production =
    safeAwardNumber(row.ppg) +
    0.55 * safeAwardNumber(row.rpg) +
    0.65 * safeAwardNumber(row.apg) +
    1.35 * safeAwardNumber(row.spg) +
    1.35 * safeAwardNumber(row.bpg);

  return production > 0.05;
}

function getPriorAwardCareerActivity(player, currentDisplaySeasonYear = null) {
  const seasons = Array.isArray(player?.history?.seasons)
    ? player.history.seasons
    : [];

  let priorCareerGames = 0;
  let priorCareerProduction = 0;
  let priorCareerSeasons = 0;

  for (const row of seasons) {
    if (!awardHistoryRowHasRealNbaActivity(row)) continue;
    const seasonYear = safeAwardNumber(row.seasonYear, null);
    if (!seasonYear) continue;
    if (currentDisplaySeasonYear && seasonYear >= Number(currentDisplaySeasonYear)) continue;

    const games = safeAwardNumber(row.games ?? row.gp, 0);
    priorCareerGames += games;
    priorCareerProduction +=
      games *
      (
        safeAwardNumber(row.ppg) +
        0.55 * safeAwardNumber(row.rpg) +
        0.65 * safeAwardNumber(row.apg) +
        1.35 * safeAwardNumber(row.spg) +
        1.35 * safeAwardNumber(row.bpg)
      );
    priorCareerSeasons += 1;
  }

  return {
    priorCareerGames,
    priorCareerProduction,
    priorCareerSeasons,
    hasPriorNbaMinutes: priorCareerGames > 0 && priorCareerProduction > 0.05,
  };
}

function getPreviousAwardSeasonFromHistory(player, currentDisplaySeasonYear = null) {
  const seasons = Array.isArray(player?.history?.seasons)
    ? player.history.seasons
    : [];

  const grouped = new Map();

  for (const row of seasons) {
    if (!row || row.rowType === "total") continue;

    const seasonYear = safeAwardNumber(row.seasonYear, null);
    if (!seasonYear) continue;

    if (currentDisplaySeasonYear && seasonYear >= Number(currentDisplaySeasonYear)) {
      continue;
    }

    if (!grouped.has(seasonYear)) grouped.set(seasonYear, []);
    grouped.get(seasonYear).push(row);
  }

  if (!grouped.size) return null;

  const latestYear = Math.max(...Array.from(grouped.keys()).map(Number));
  return combineAwardSeasonRows(grouped.get(latestYear) || []);
}

function buildAwardRosterMetaLookup(allTeams, currentDisplaySeasonYear = null) {
  const map = {};

  for (const t of (allTeams || [])) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    for (const pl of (t.players || [])) {
      const playerName = pl?.name || pl?.player;
      if (!playerName) continue;

      const mipPrev = getPreviousAwardSeasonFromHistory(pl, currentDisplaySeasonYear);
      const careerActivity = getPriorAwardCareerActivity(pl, currentDisplaySeasonYear);

      map[`${playerName}__${teamName}`] = {
        age: pl?.age,
        ...careerActivity,
        overall: pl?.overall ?? pl?.ovr ?? pl?.rating ?? pl?.overall_rating,
        potential: pl?.potential ?? pl?.pot ?? pl?.potential_rating,
        offRating: pl?.offRating ?? pl?.off_rating,
        defRating: pl?.defRating ?? pl?.def_rating,
        mip_prev: mipPrev,
        mipPrev,
        previousSeasonStats: mipPrev,
        draftYear: pl?.draftYear ?? pl?.draft_year,
        rookieYear: pl?.rookieYear ?? pl?.rookie_year,
        rookieSeason: pl?.rookieSeason ?? pl?.rookie_season,
        rookieSeasonYear: pl?.rookieSeasonYear ?? pl?.rookie_season_year,
        isRookie: pl?.isRookie ?? pl?.is_rookie,
        rookie: pl?.rookie,
        rookieEligible: pl?.rookieEligible ?? pl?.rookie_eligible,
        rotyEligible: pl?.rotyEligible ?? pl?.roty_eligible,
        proSeasons: pl?.proSeasons ?? pl?.pro_seasons,
        seasonsPro: pl?.seasonsPro ?? pl?.seasons_pro,
        yearsPro: pl?.yearsPro ?? pl?.years_pro,
        yearsOfExperience: pl?.yearsOfExperience ?? pl?.years_of_experience,
        yoe: pl?.yoe,
        contractType: pl?.contractType ?? pl?.contract_type,
        rosterStatus: pl?.rosterStatus ?? pl?.roster_status,
        contract: pl?.contract,
        meta: pl?.meta,
      };
    }
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/*                           MAIN CALENDAR COMPONENT                          */
/* -------------------------------------------------------------------------- */
const FIRST_PLAYABLE_SEASON_YEAR = 2025;

function calendarValidSeasonYear(value) {
  const y = Number(value);
  return Number.isFinite(y) && y >= 2020 && y <= 2100 ? Math.trunc(y) : null;
}

function parseCalendarDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getCalendarLeagueSeasonYear(leagueData) {
  return calendarValidSeasonYear(getSeasonStartYear(leagueData || {}));
}

export default function Calendar() {
  
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam } = useGame();
  if (window.__debugSimLogs) console.log("🔥 Calendar leagueData =", leagueData);
  window.__leagueData = leagueData;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    prewarmCpuTradeWorker();
    prewarmCpuTradeValidationPool();
  }, []);



  /* -------------------------------- Season Window ------------------------------- */
  const META_KEY = "bm_league_meta_v1";
  const leagueSeasonYear = getCalendarLeagueSeasonYear(leagueData);
  let storedSeasonYear = null;
  try {
    const metaRaw = localStorage.getItem(META_KEY);
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    storedSeasonYear =
      calendarValidSeasonYear(meta?.seasonYear) ??
      calendarValidSeasonYear(meta?.currentSeasonYear) ??
      calendarValidSeasonYear(meta?.seasonStartYear);
  } catch {}

  const seasonYear =
    leagueSeasonYear ??
    (leagueData ? FIRST_PLAYABLE_SEASON_YEAR : storedSeasonYear ?? FIRST_PLAYABLE_SEASON_YEAR);

  const seasonCalendarConfig = useMemo(
    () => getSeasonCalendarConfig({ ...(leagueData || {}), seasonYear, currentSeasonYear: seasonYear, seasonStartYear: seasonYear }),
    [leagueData, seasonYear]
  );
  const userTradeDeadlineEnabled = getUserTradeRuleSettings(leagueData || {}).tradeDeadline;

  const cpuTradeGenerationJobRef = useRef(null);

  useEffect(() => {
    if (!leagueData || !seasonYear || !leagueData?.cpuTradeBankState) return;

    const tradeDeadlineDate = seasonCalendarConfig.tradeDeadlineDate || fmt(new Date(seasonYear + 1, 1, 4));
    const seasonStartDate = seasonCalendarConfig.regularSeasonStart || fmt(new Date(seasonYear, 9, 21));
    const initialDaysToDeadline = Math.max(1, daysBetweenDateStrings(seasonStartDate, tradeDeadlineDate));
    const testConfig = readCpuTradeBankTestConfig();
    const initialized = ensureCpuTradeBankState(
      leagueData,
      {
        seasonYear,
        currentDate: seasonStartDate,
        dayIndex: 0,
        totalDates: Math.max(1, initialDaysToDeadline + 68),
        tradeDeadlineDate,
        daysToDeadline: initialDaysToDeadline,
        deadlineDayIndex: initialDaysToDeadline,
      },
      testConfig
    );

    if (!initialized.changed || !initialized.leagueData) return;

    setLeagueData(initialized.leagueData);
    saveLeagueData(initialized.leagueData).catch((error) => {
      console.warn("[CPU Trade Bank] failed to save initialized bank", error);
    });
  }, [leagueData, seasonYear, seasonCalendarConfig, setLeagueData]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const resetDebugBank = () => {
      const currentLeague = window.__leagueData || leagueData || null;
      if (!currentLeague) return { reset: false, reason: "missing_league" };

      const nextLeague = { ...currentLeague };
      delete nextLeague.cpuTradeBankState;
      setLeagueData(nextLeague);
      saveLeagueData(nextLeague).catch((error) => {
        console.warn("[CPU Trade Bank] failed to save debug bank reset", error);
      });

      window.__leagueData = nextLeague;
      window.leagueData = nextLeague;
      window.__basketballManagerLeagueData = nextLeague;
      cpuTradeGenerationJobRef.current = null;
      return { reset: true };
    };

    const applyDebugPreset = (patch) => {
      const config = writeCpuTradeBankTestConfig(patch);
      resetDebugBank();
      return config;
    };

    installCpuTradeTraceConsoleApi(() => {
      const currentLeague = window.__leagueData || leagueData || {};
      return {
        bankSummary: buildCpuTradeBankSummary(currentLeague),
        diagnosticReport: buildCpuTradeDiagnosticReport(currentLeague, { runBenchmarks: false }),
      };
    });

    window.__cpuTradeBankDebug = {
      report: () => buildCpuTradeBankSummary(window.__leagueData || leagueData || {}),
      getState: () => (window.__leagueData || leagueData || {})?.cpuTradeBankState || null,
      getConfig: () => readCpuTradeBankTestConfig(),
      configure: (patch = {}) => writeCpuTradeBankTestConfig(patch),
      configureAndReset: (patch = {}) => applyDebugPreset(patch),
      resetBank: () => resetDebugBank(),
      clearConfig: () => {
        const config = clearCpuTradeBankTestConfig();
        resetDebugBank();
        return config;
      },
      presets: {
        deterministic: () => applyDebugPreset({ seed: "cpu-trade-diagnostic" }),
        rapidBuild: () =>
          applyDebugPreset({
            seed: "cpu-trade-diagnostic",
            forceGeneration: true,
            generationCandidates: 8,
            exactEvaluations: 8,
          }),
        executionDryRun: () =>
          applyDebugPreset({
            seed: "cpu-trade-diagnostic",
            forceGeneration: true,
            forceExecution: true,
            dryRun: true,
            generationCandidates: 8,
            exactEvaluations: 8,
          }),
        accelerated: () =>
          applyDebugPreset({
            seed: "cpu-trade-diagnostic",
            forceGeneration: true,
            forceExecution: true,
            dryRun: false,
            generationCandidates: 8,
            exactEvaluations: 8,
          }),
      },
    };

    return () => {
      if (window.__cpuTradeBankDebug) delete window.__cpuTradeBankDebug;
      if (window.__cpuTradeTrace) delete window.__cpuTradeTrace;
    };
  }, [leagueData]);

  useEffect(() => {
    const y = calendarValidSeasonYear(leagueSeasonYear ?? seasonYear);
    if (!y) return;

    try {
      const raw = localStorage.getItem(META_KEY);
      const meta = raw ? JSON.parse(raw) : {};
      const currentMetaYear =
        calendarValidSeasonYear(meta?.seasonYear) ??
        calendarValidSeasonYear(meta?.currentSeasonYear) ??
        calendarValidSeasonYear(meta?.seasonStartYear);

      if (currentMetaYear !== y) {
        localStorage.setItem(
          META_KEY,
          JSON.stringify({
            ...meta,
            seasonYear: y,
            currentSeasonYear: y,
            seasonStartYear: y,
          })
        );
      }
    } catch {}
  }, [leagueSeasonYear, seasonYear]);

  const CALENDAR_CURSOR_KEY = `bm_calendar_cursor_v1_${seasonYear}`;
  const CALENDAR_SIM_CURSOR_KEY = `bm_calendar_sim_cursor_v1_${seasonYear}`;

  const seasonStart = useMemo(
    () => parseCalendarDate(seasonCalendarConfig.regularSeasonStart) || new Date(seasonYear, 9, 21),
    [seasonCalendarConfig, seasonYear]
  );
  const seasonEnd = useMemo(
    () => parseCalendarDate(seasonCalendarConfig.regularSeasonEnd) || new Date(seasonYear + 1, 3, 12),
    [seasonCalendarConfig, seasonYear]
  );

  const allDays = useMemo(
    () => rangeDays(seasonStart, seasonEnd),
    [seasonStart, seasonEnd]
  );

  /* --------------------------------- TEAM LIST --------------------------------- */
const teams = useMemo(() => {
  if (!leagueData) return [];

  const arr = getAllTeamsFromLeague(leagueData);
  if (window.__debugCalendarTeams) console.log("🔥 DEBUG Calendar loaded teams:", arr);
  window.__debugTeams = arr;

  return arr.map((t) => ({
    ...t,
    id: slugifyId(t.name),
  }));
}, [leagueData]);
const selectedTeamPlayerCount = useMemo(() => {
  return getTeamPlayerCount(selectedTeam);
}, [selectedTeam]);

const selectedTeamSimBlockMessage = useMemo(() => {
  return getUserRosterSimBlockMessage(selectedTeam);
}, [selectedTeam, selectedTeamPlayerCount]);

const selectedTeamCanSim = !selectedTeamSimBlockMessage;


  /* ---------------------------- Team Switch Controls ---------------------------- */
  const allTeamsSorted = useMemo(
    () => [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [teams]
  );

  const [viewTeamName, setViewTeamName] = useState(null);

  useEffect(() => {
    if (selectedTeam?.name) setViewTeamName(selectedTeam.name);
  }, [selectedTeam?.name]);

  const calendarViewTeam = useMemo(() => {
    const targetName = viewTeamName || selectedTeam?.name;
    return allTeamsSorted.find((team) => team.name === targetName) || selectedTeam || allTeamsSorted[0] || null;
  }, [allTeamsSorted, viewTeamName, selectedTeam]);

  const currentIndex = useMemo(() => {
    return calendarViewTeam
      ? allTeamsSorted.findIndex((t) => t.name === calendarViewTeam.name)
      : -1;
  }, [calendarViewTeam, allTeamsSorted]);

  const handleTeamSwitch = (dir) => {
    if (!allTeamsSorted.length || currentIndex < 0) return;

    const i =
      dir === "next"
        ? (currentIndex + 1) % allTeamsSorted.length
        : (currentIndex - 1 + allTeamsSorted.length) %
          allTeamsSorted.length;

    setViewTeamName(allTeamsSorted[i]?.name || null);
  };

  useKeyboardTeamNavigation({
    enabled: allTeamsSorted.length > 1,
    onPrevious: () => handleTeamSwitch("prev"),
    onNext: () => handleTeamSwitch("next"),
  });

  useEffect(() => {
    if (selectedTeam)
      localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam.name));
  }, [selectedTeam]);

  /* ----------------------------- LOCAL STORAGE KEYS ----------------------------- */
  const SCHED_KEY = "bm_schedule_v3";
  const RESULT_KEY = "bm_results_v2";
  const PLAYER_STATS_KEY = "bm_player_stats_v1";
  const AWARD_DISPLAY_STATS_KEY = "bm_award_display_stats_v1";
  const CALENDAR_MOOD_CONTEXT_KEY = "bm_calendar_mood_context_v1";
  // ===============================
  // FAST RESULTS STORE (per-game)
  // ===============================
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_"; // each game stored as bm_result_v3_<gameId>
const ALL_STAR_LOGIC_VERSION = "all_star_gp_eligibility_v4_20260806";
const RESULT_V2_BLOB_KEY = "bm_results_v2"; // legacy blob (for migration)

const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

function isQuotaError(err) {
  return (
    err?.name === "QuotaExceededError" ||
    String(err?.message || "").toLowerCase().includes("quota")
  );
}

function clearNonCriticalQuotaCaches() {
  try { removeLegacyResultsBlob(); } catch {}
  try { localStorage.removeItem(PLAYER_MOOD_EVENT_BUS_KEY); } catch {}
  // bm_awards_latest duplicated bm_awards_v1 but had no readers. Clear any
  // legacy copy first so critical current-season saves always win the quota.
  try { localStorage.removeItem("bm_awards_latest"); } catch {}
}

function hasBoxRows(slim) {
  return !!(
    slim?.box &&
    ((Array.isArray(slim.box.home) && slim.box.home.length > 0) ||
      (Array.isArray(slim.box.away) && slim.box.away.length > 0))
  );
}

function compactResultForCalendar(slim) {
  if (!slim) return null;

  // localStorage is only the synchronous score/index layer. The complete box
  // score (including periods and frozen rotation order) already lives in
  // IndexedDB, so duplicating those fields for all 1,230 games wastes enough
  // space to hit the browser quota in later seasons.
  return {
    winner: slim.winner || null,
    totals: slim.totals || {
      home: Number(slim?.winner?.home || 0),
      away: Number(slim?.winner?.away || 0),
    },
    hasBoxScore: Boolean(slim?.hasBoxScore || hasBoxRows(slim)),
  };
}

function readCompressedOrJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }

    try {
      return JSON.parse(raw);
    } catch {}

    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function writeCompressedJson(key, value) {
  const json = JSON.stringify(value || {});
  const compressed = "lz:" + LZString.compressToUTF16(json);
  localStorage.setItem(key, compressed);
}

function removeLegacyResultsBlob() {
  try {
    localStorage.removeItem(RESULT_V2_BLOB_KEY);
  } catch {}
}

function loadResultsIndexV3() {
  try {
    const raw = localStorage.getItem(RESULT_V3_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveResultsIndexV3(ids) {
  const payload = JSON.stringify(ids);
  try {
    localStorage.setItem(RESULT_V3_INDEX_KEY, payload);
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn("[ResultsV3] failed saving index", e);
      return false;
    }

    clearNonCriticalQuotaCaches();
    try {
      localStorage.setItem(RESULT_V3_INDEX_KEY, payload);
    } catch (retryError) {
      console.warn("[ResultsV3] failed saving index after quota recovery", retryError);
      return false;
    }
  }
  return true;
}

function reconcileResultStoreV3WithSchedule(schedule = {}) {
  try {
    const scheduleIds = new Set();
    for (const games of Object.values(schedule || {})) {
      for (const game of games || []) {
        if (game?.id) scheduleIds.add(String(game.id));
      }
    }

    if (scheduleIds.size === 0) {
      return { removed: 0, repaired: 0, kept: loadResultsIndexV3().length };
    }

    const keptIds = new Set();
    let removed = 0;
    let repaired = 0;

    // Scan the actual keyspace instead of trusting the index. Older cleanup
    // removed the index first and deleted payloads later, so a reload could
    // leave an entire prior season as invisible quota-consuming orphan keys.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(RESULT_V3_PREFIX)) continue;

      const gameId = key.slice(RESULT_V3_PREFIX.length);
      if (scheduleIds.size > 0 && scheduleIds.has(gameId)) {
        keptIds.add(gameId);
      } else {
        localStorage.removeItem(key);
        removed += 1;
      }
    }

    const priorIds = new Set(loadResultsIndexV3().map(String));
    for (const id of keptIds) {
      if (!priorIds.has(id)) repaired += 1;
    }

    if (keptIds.size > 0) {
      saveResultsIndexV3(Array.from(keptIds));
    } else {
      localStorage.removeItem(RESULT_V3_INDEX_KEY);
    }

    resultIndexSetRef.current = new Set(keptIds);
    resultIndexDirtyRef.current = false;

    if (removed > 0 || repaired > 0) {
      console.log("[ResultsV3] reconciled result storage", {
        removedStaleKeys: removed,
        repairedIndexEntries: repaired,
        activeResultKeys: keptIds.size,
      });
    }

    return { removed, repaired, kept: keptIds.size };
  } catch (error) {
    console.warn("[ResultsV3] result-store reconciliation failed", error);
    return { removed: 0, repaired: 0, kept: 0 };
  }
}

const resultWriteQueueRef = useRef(Promise.resolve());
const boxScoreBatchRef = useRef([]);
const resultIndexSetRef = useRef(null);
const resultIndexDirtyRef = useRef(false);

function getResultIndexSet() {
  if (!(resultIndexSetRef.current instanceof Set)) {
    resultIndexSetRef.current = new Set(loadResultsIndexV3());
  }
  return resultIndexSetRef.current;
}

function flushResultIndexCache() {
  if (!resultIndexDirtyRef.current || !(resultIndexSetRef.current instanceof Set)) return;
  saveResultsIndexV3(Array.from(resultIndexSetRef.current));
  resultIndexDirtyRef.current = false;
}

function flushBoxScoreBatch() {
  if (!boxScoreBatchRef.current.length) return resultWriteQueueRef.current;
  const rows = boxScoreBatchRef.current.splice(0, boxScoreBatchRef.current.length);
  resultWriteQueueRef.current = resultWriteQueueRef.current
    .catch(() => {})
    .then(() => saveBoxScoresBatchToDB(rows));
  return resultWriteQueueRef.current;
}

function enqueueBoxScoreBatchRow(row) {
  boxScoreBatchRef.current.push(row);
  if (boxScoreBatchRef.current.length >= 25) flushBoxScoreBatch();
  return resultWriteQueueRef.current;
}

function enqueueBoxScoreWrite(task) {
  resultWriteQueueRef.current = resultWriteQueueRef.current
    .catch(() => {})
    .then(task);
  return resultWriteQueueRef.current;
}

async function flushPendingResultWrites() {
  flushResultIndexCache();
  flushBoxScoreBatch();
  try {
    await resultWriteQueueRef.current;
  } catch (error) {
    console.warn("[ResultsV3] pending box-score write failed", error);
  }
}

function sameLockedScore(a, b) {
  if (!a || !b) return true;
  return (
    Number(a?.totals?.home ?? a?.winner?.home ?? 0) ===
      Number(b?.totals?.home ?? b?.winner?.home ?? 0) &&
    Number(a?.totals?.away ?? a?.winner?.away ?? 0) ===
      Number(b?.totals?.away ?? b?.winner?.away ?? 0)
  );
}

function loadOneResultV3(gameId) {
  try {
    const stored = localStorage.getItem(resultV3Key(gameId));
    if (!stored) return null;

    const decompressed = LZString.decompressFromUTF16(stored);
    const json = decompressed || stored;
    const parsed = JSON.parse(json);
    const compact = compactResultForCalendar(parsed);

    // Old saves may still have full box scores in localStorage. Preserve the
    // complete result in IndexedDB before replacing the local copy.
    if (hasBoxRows(parsed)) {
      saveBoxScoreToDB(gameId, parsed)
        .then(() => {
          try {
            localStorage.setItem(
              resultV3Key(gameId),
              LZString.compressToUTF16(JSON.stringify(compact))
            );
          } catch (e) {
            console.warn("[ResultsV3] failed compacting migrated result", gameId, e);
          }
        })
        .catch((e) => console.warn("[IndexedDB] failed migrating box score", gameId, e));

      return compact;
    }

    // Shrink older score-only rows that still duplicate periods,
    // rotationOrder, empty box arrays, or timestamps. Replacing a value with a
    // smaller value works even when localStorage is already near its quota.
    const canonicalJson = JSON.stringify(compact);
    if (canonicalJson !== JSON.stringify(parsed)) {
      try {
        localStorage.setItem(
          resultV3Key(gameId),
          LZString.compressToUTF16(canonicalJson)
        );
      } catch (e) {
        console.warn("[ResultsV3] failed compacting migrated result", gameId, e);
      }
    }

    return compact;
  } catch {
    return null;
  }
}

function saveOneResultV3(gameId, slim, game = null, seasonYearValue = null, options = {}) {
  if (!gameId || !slim) return Promise.resolve(null);

  const existing = loadOneResultV3(gameId);
  if (existing?.totals && !sameLockedScore(existing, slim)) {
    console.error("[ResultsV3] refused to overwrite locked completed game", {
      gameId,
      existing: existing.totals,
      incoming: slim?.totals,
    });
    return Promise.resolve(existing);
  }

  if (!slim.lockedAt) slim.lockedAt = Date.now();

  if (hasBoxRows(slim)) {
    enqueueBoxScoreBatchRow({
      gameId,
      result: slim,
      seasonYear: seasonYearValue,
      home: game?.home,
      away: game?.away,
    });
  }

  try {
    const compact = compactResultForCalendar(slim);
    const json = JSON.stringify(compact);
    const compressed = LZString.compressToUTF16(json);

    try {
      localStorage.setItem(resultV3Key(gameId), compressed);
    } catch (writeError) {
      if (!isQuotaError(writeError)) throw writeError;
      clearNonCriticalQuotaCaches();
      localStorage.setItem(resultV3Key(gameId), compressed);
    }

    const ids = getResultIndexSet();
    if (!ids.has(gameId)) {
      ids.add(gameId);
      resultIndexDirtyRef.current = true;
    }
    if (!options?.deferIndexWrite) flushResultIndexCache();
  } catch (e) {
    console.error("[ResultsV3] failed saving compact game", gameId, e);
  }

  // Return the canonical score object immediately. Box-score persistence stays
  // on the batched write queue and is awaited by flushPendingResultWrites().
  // This prevents callers from placing a newly simulated score into live state
  // when storage has already locked a different completed result.
  return Promise.resolve(existing || slim);
}

function deleteOneResultV3(gameId) {
  try {
    localStorage.removeItem(resultV3Key(gameId));
    deleteBoxScoreFromDB(gameId).catch(() => {});
    const ids = getResultIndexSet();
    ids.delete(gameId);
    resultIndexDirtyRef.current = true;
    flushResultIndexCache();
  } catch {}
}

function clearAllResultsV3() {
  try {
    // Never rely only on the index here. A missing/partial index is exactly how
    // stale prior-season result keys became permanent localStorage orphans.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(RESULT_V3_PREFIX)) localStorage.removeItem(key);
    }
    localStorage.removeItem(RESULT_V3_INDEX_KEY);
    clearBoxScoresFromDB().catch(() => {});
    resultIndexSetRef.current = new Set();
    resultIndexDirtyRef.current = false;
  } catch {}
}

function migrateResultsV2BlobToV3IfNeeded() {
  try {
    const blob = localStorage.getItem(RESULT_V2_BLOB_KEY);
    if (!blob) return;

    const existing = loadResultsIndexV3();
    if (existing.length > 0) {
      removeLegacyResultsBlob();
      return;
    }

    const decompressed = LZString.decompressFromUTF16(blob);
    const json = decompressed || blob;
    const obj = JSON.parse(json) || {};
    const ids = Object.keys(obj);

    for (const id of ids) {
      const slim = obj[id];
      if (!slim) continue;

      if (hasBoxRows(slim)) {
        saveBoxScoreToDB(id, slim).catch((e) =>
          console.warn("[IndexedDB] failed migrating v2 box score", id, e)
        );
      }

      const compact = compactResultForCalendar(slim);
      localStorage.setItem(
        resultV3Key(id),
        LZString.compressToUTF16(JSON.stringify(compact))
      );
    }

    saveResultsIndexV3(ids);
    removeLegacyResultsBlob();

    console.log("[ResultsV3] migrated", ids.length, "games from v2 blob into compact localStorage + IndexedDB boxes");
  } catch (e) {
    console.warn("[ResultsV3] migration failed", e);
  }
}

function loadAllResultsV3() {
  const ids = loadResultsIndexV3();
  const out = {};

  for (const id of ids) {
    const r = loadOneResultV3(id);
    if (r) out[id] = compactResultForCalendar(r);
  }

  return out;
}

function loadResults() {
  migrateResultsV2BlobToV3IfNeeded();
  return loadAllResultsV3();
}

function hasUsableStoredResult(result) {
  if (!result || result.error) return false;

  const totals = result.totals || {};
  const home = Number(totals.home ?? result?.winner?.home ?? 0);
  const away = Number(totals.away ?? result?.winner?.away ?? 0);

  if ((home > 0 || away > 0) && Number.isFinite(home) && Number.isFinite(away)) {
    return true;
  }

  if (result.hasBoxScore) return true;

  const homeBox = result?.box?.home;
  const awayBox = result?.box?.away;

  return (
    (Array.isArray(homeBox) && homeBox.length > 0) ||
    (Array.isArray(awayBox) && awayBox.length > 0)
  );
}

function hydrateSchedulePlayedFlagsFromResults(schedule, results) {
  const hydrated = {};
  let changed = false;
  let hydratedCount = 0;

  for (const [date, games] of Object.entries(schedule || {})) {
    hydrated[date] = Array.isArray(games)
      ? games.map((game) => {
          if (!game?.id) return game;

          const hasResult = hasUsableStoredResult(results?.[game.id]);

          if (hasResult && !game.played) {
            changed = true;
            hydratedCount += 1;
            return { ...game, played: true };
          }

          return game;
        })
      : games;
  }

  return {
    schedule: hydrated,
    changed,
    hydratedCount,
  };
}

function loadPlayerStats() {
  return readCompressedOrJson(PLAYER_STATS_KEY, {});
}

function savePlayerStats(stats) {
  try {
    writeCompressedJson(PLAYER_STATS_KEY, stats || {});
    return true;
  } catch (e) {
    console.warn("[Calendar] compressed player stats save failed", e);

    if (isQuotaError(e)) clearNonCriticalQuotaCaches();

    try {
      writeCompressedJson(PLAYER_STATS_KEY, stats || {});
      return true;
    } catch (err) {
      console.error("[Calendar] player stats save failed after retry", err);
      return false;
    }
  }
}


function parsePair(s) {
  const [m, a] = String(s || "0-0").split("-").map(Number);
  return { m: m || 0, a: a || 0 };
}


function normalizeMoodEventIdPart(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rowNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildGamePerformanceMoodEvents(slim, game, currentDate, context = {}) {
  return buildRealisticGameMoodEvents({
    slim,
    game,
    currentDate,
    ...context,
  });
}

function collectMoodPlayerRefs(value, refs = [], context = {}) {
  if (!value) return refs;

  if (Array.isArray(value)) {
    for (const item of value) collectMoodPlayerRefs(item, refs, context);
    return refs;
  }

  if (typeof value !== "object") return refs;

  const name = String(
    value.playerName ||
      value.player ||
      value.name ||
      value.fullName ||
      ""
  ).trim();

  const looksLikePlayer = Boolean(
    value.playerName ||
      value.player ||
      value.pos ||
      value.position ||
      value.overall ||
      value.ovr ||
      value.pts ||
      value.ppg ||
      value.team
  );

  if (name && looksLikePlayer) {
    refs.push({
      playerName: name,
      teamName: String(value.teamName || value.team || context.teamName || "").trim(),
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (["playerName", "player", "name", "fullName"].includes(key)) continue;
    collectMoodPlayerRefs(child, refs, {
      ...context,
      teamName: value.teamName || value.team || context.teamName || "",
    });
  }

  return refs;
}

function uniqueMoodPlayerRefs(refs = []) {
  const byName = new Map();
  for (const ref of refs) {
    const playerName = String(ref?.playerName || "").trim();
    if (!playerName) continue;
    const key = normalizeMoodEventIdPart(playerName);
    if (!key) continue;
    byName.set(key, {
      playerName,
      teamName: String(ref?.teamName || "").trim(),
    });
  }
  return [...byName.values()];
}

function moodMilestoneEvent({ idPrefix, playerName, teamName = "", category, impact, text, detail, type, date }) {
  const cleanName = String(playerName || "").trim();
  if (!cleanName) return null;
  const cleanPrefix = normalizeMoodEventIdPart(idPrefix || type || category || "milestone");
  return {
    id: `${cleanPrefix}_${normalizeMoodEventIdPart(cleanName)}_${normalizeMoodEventIdPart(date || "date")}`,
    playerName: cleanName,
    playerKey: `name:${cleanName}`,
    category,
    modifierType: "temporary",
    impact,
    baseImpact: impact,
    decayMode: "percent_of_original",
    decayPctPerWeek: 5,
    text,
    detail,
    type,
    duration: "temporary",
    date,
    source: "calendar_milestone_event_bus",
    teamName,
    hideWhenExpired: true,
  };
}

function buildAllStarMoodEvents(allStarResult, currentDate) {
  const refs = uniqueMoodPlayerRefs(collectMoodPlayerRefs(allStarResult));
  return refs
    .map((ref) =>
      moodMilestoneEvent({
        idPrefix: "all_star_selection",
        playerName: ref.playerName,
        teamName: ref.teamName,
        category: "All-Star Selection",
        impact: 5,
        text: "Being named an All-Star gave him a short-term mood boost.",
        detail: ref.teamName ? `${ref.teamName} representative.` : "League recognition.",
        type: "all_star_selection",
        date: currentDate,
      })
    )
    .filter(Boolean);
}

function buildAwardMoodEvents(awards = {}, currentDate) {
  const events = [];
  const awardLabels = {
    mvp: ["MVP Award", 10],
    dpoy: ["DPOY Award", 8],
    roty: ["ROTY Award", 7],
    sixth_man: ["Sixth Man Award", 6],
    sixthMan: ["Sixth Man Award", 6],
    mip: ["Most Improved Award", 6],
    clutch_player: ["Clutch Player of the Year", 7],
    all_nba: ["All-NBA Selection", 7],
    allNBA: ["All-NBA Selection", 7],
    all_defense: ["All-Defense Selection", 6],
    allDefense: ["All-Defense Selection", 6],
    all_defensive_first: ["All-Defensive First Team", 7],
    all_defensive_second: ["All-Defensive Second Team", 6],
    all_rookie_first: ["All-Rookie First Team", 6],
    all_rookie_second: ["All-Rookie Second Team", 5],
  };

  const visit = (value, keyHint = "award") => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const row of value) visit(row, keyHint);
      return;
    }
    if (typeof value !== "object") return;

    const [category, impact] = awardLabels[keyHint] || ["League Award", 6];
    const refs = uniqueMoodPlayerRefs(collectMoodPlayerRefs(value));
    for (const ref of refs.slice(0, 20)) {
      const event = moodMilestoneEvent({
        idPrefix: `${keyHint}_award`,
        playerName: ref.playerName,
        teamName: ref.teamName,
        category,
        impact,
        text: `${category} recognition gave him a major morale boost.`,
        detail: ref.teamName ? `${ref.teamName} recognition.` : "League recognition.",
        type: normalizeMoodEventIdPart(category),
        date: currentDate,
      });
      if (event) events.push(event);
    }
  };

  for (const [key, value] of Object.entries(awards || {})) {
    visit(value, key);
  }

  return events;
}
// ------------------------------------------------------------
// SIXTH MAN ROLE HELPERS (starter vs sixth vs bench)
// ------------------------------------------------------------

// Mutates slim.box rows by adding row.role = "starter" | "sixth_man" | "bench"
function annotateSlimWithRoles(
  slim,
  homeRoleMap,
  awayRoleMap,
  homeOrder = [],
  awayOrder = []
) {
  if (!slim || !slim.box) return slim;

  const apply = (side, roleMap) => {
    const rows = slim.box?.[side] || [];
    for (const row of rows) {
      const nm = row?.player;
      row.role = (nm && roleMap && roleMap[nm]) ? roleMap[nm] : "bench";
    }
  };

  apply("home", homeRoleMap);
  apply("away", awayRoleMap);

  slim.rotationOrder = {
    home: Array.isArray(homeOrder) ? [...homeOrder] : [],
    away: Array.isArray(awayOrder) ? [...awayOrder] : [],
  };

  return slim;
}


// slim = result from slimResult(full)
function applyGameToPlayerStats(stats, slim, game) {
  if (!slim?.box) return stats;

  const toNum = (v) => {
    if (typeof v === "string" && v.includes(":")) {
      const [mins, secs] = v.split(":").map((part) => Number(part));
      const m = Number.isFinite(mins) ? mins : 0;
      const s = Number.isFinite(secs) ? secs : 0;
      return m + s / 60;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const updateSide = (side, teamName) => {
    const rows = slim.box[side] || [];
    const playedRows = rows.filter((row) => toNum(row?.min ?? row?.minutes) > 0);

// Determine starters. Every non-starter appearance counts as a bench appearance for 6MOY.
const sortedByMin = [...playedRows].sort((a, b) => toNum(b.min) - toNum(a.min));
const starters = new Set(sortedByMin.slice(0, 5).map((r) => r.player));

    for (const row of playedRows) {
      const key = `${row.player}__${teamName}`;
      const cur = stats[key] || {
        player: row.player,
        team: teamName,
        gp: 0,
        min: 0,
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        fgm: 0,
        fga: 0,
        tpm: 0,
        tpa: 0,
        ftm: 0,
        fta: 0,
        to: 0,
        pf: 0,
        // 🔥 role tracking
        started: 0,
        sixth: 0,
      };

      cur.gp += 1;
      cur.min += toNum(row.min);
      cur.pts += toNum(row.pts);
      cur.reb += toNum(row.reb);
      cur.ast += toNum(row.ast);
      cur.stl += toNum(row.stl);
      cur.blk += toNum(row.blk);
      cur.to += toNum(row.to ?? row.tov ?? row.turnovers);
      cur.pf += toNum(row.pf ?? row.fouls);

      const { m: fgm, a: fga } = parsePair(row.fg);
      const { m: tpm, a: tpa } = parsePair(row["3p"]);
      const { m: ftm, a: fta } = parsePair(row.ft);

      cur.fgm += fgm;
      cur.fga += fga;
      cur.tpm += tpm;
      cur.tpa += tpa;
      cur.ftm += ftm;
      cur.fta += fta;

      // Role tracking: starts vs bench appearances.
const role = row.role; // may exist if slim was annotated from coach gameplan roles
if (role === "starter") cur.started += 1;
else if (role) cur.sixth += 1;
else {
  // If role is missing from older results, fall back to top-five minutes as starters.
  if (starters.has(row.player)) cur.started += 1;
  else cur.sixth += 1;
}

      stats[key] = cur;
    }
  };

  updateSide("home", game.home);
  updateSide("away", game.away);
  return stats;
}

// 🔥 Rebuild player stats from existing schedule + results
  function recomputePlayerSeasonStatsFromResults(schedule, results) {
    let stats = {};
    let clutchStats = createEmptyClutchStats(seasonYear);

    for (const games of Object.values(schedule || {})) {
      for (const g of games || []) {
        const slim = results?.[g.id];
        if (!slim) continue;
        stats = applyGameToPlayerStats(stats, slim, g);
        clutchStats = applyGameToClutchStats(clutchStats, slim, g, seasonYear);
      }
    }

    savePlayerStats(stats);
    saveClutchStats(clutchStats);
    console.log(
      "[Calendar] recomputed player and clutch stats from existing results:",
      Object.keys(stats).length,
      "players"
    );
    return stats;
  }

  async function rebuildPlayerSeasonStatsFromCanonicalBoxScores(schedule, results) {
    const gameRows = [];
    for (const games of Object.values(schedule || {})) {
      for (const game of games || []) {
        if (!game?.id) continue;
        if (!game.played && !hasUsableStoredResult(results?.[game.id])) continue;
        gameRows.push(game);
      }
    }

    await flushPendingResultWrites();

    const boxScoresById = await loadBoxScoresByGameIdsFromDB(
      gameRows.map((game) => game.id)
    );

    let stats = {};
    let clutchStats = createEmptyClutchStats(seasonYear);
    const missingGameIds = [];
    let processedGames = 0;
    let memoryFallbackGames = 0;

    for (const game of gameRows) {
      const dbSlim = boxScoresById?.[game.id];
      const memorySlim = results?.[game.id];
      const slim = hasBoxRows(dbSlim) ? dbSlim : hasBoxRows(memorySlim) ? memorySlim : null;
      if (!slim?.box || !hasBoxRows(slim)) {
        missingGameIds.push(game.id);
        continue;
      }
      if (slim === memorySlim && slim !== dbSlim) memoryFallbackGames += 1;
      stats = applyGameToPlayerStats(stats, slim, game);
      clutchStats = applyGameToClutchStats(clutchStats, slim, game, seasonYear);
      processedGames += 1;
    }

    return {
      stats,
      clutchStats,
      processedGames,
      expectedGames: gameRows.length,
      missingGameIds,
      memoryFallbackGames,
    };
  }

  function statRowHasRealProduction(row = {}) {
    return (
      Number(row?.pts || 0) +
      Number(row?.reb || 0) +
      Number(row?.ast || 0) +
      Number(row?.stl || 0) +
      Number(row?.blk || 0) +
      Number(row?.fga || 0) +
      Number(row?.fta || 0) +
      Number(row?.tpa || 0)
    ) > 0;
  }

  function getAwardEligiblePlayerCount(stats = {}) {
    return Object.values(stats || {}).filter((row) => Number(row?.gp || 0) >= 65 && statRowHasRealProduction(row)).length;
  }

  function countRealStatRows(stats = {}) {
    return Object.values(stats || {}).filter((row) => Number(row?.gp || 0) > 0 && statRowHasRealProduction(row)).length;
  }

  function chooseBestStatsForAwards(candidates = []) {
    let best = null;
    for (const candidate of candidates) {
      if (!candidate?.stats) continue;
      const eligible = getAwardEligiblePlayerCount(candidate.stats);
      const realRows = countRealStatRows(candidate.stats);
      const totalRows = Object.keys(candidate.stats || {}).length;
      const score = eligible * 100000 + realRows * 100 + totalRows;
      if (!best || score > best.score) {
        best = { ...candidate, eligible, realRows, totalRows, score };
      }
    }
    return best;
  }



  const [scheduleByDate, setScheduleByDate] = useState({});
  const [resultsById, setResultsById] = useState({});
  // expose for debugging
window.__sched = scheduleByDate;
window.__results = resultsById;
window.__teams = teams;
window.__results = resultsById;




  const saveSchedule = (obj) => {
    setScheduleByDate(obj);
    const payload = JSON.stringify(obj);
    try {
      localStorage.setItem(SCHED_KEY, payload);
    } catch (e) {
      if (!isQuotaError(e)) {
        console.warn("[Calendar] schedule save failed", e);
        return;
      }

      clearNonCriticalQuotaCaches();
      try {
        localStorage.setItem(SCHED_KEY, payload);
      } catch (retryError) {
        console.warn("[Calendar] schedule save failed after quota recovery", retryError);
      }
    }
  };


async function saveResults(results, { persistBoxes = false } = {}) {
  try {
    const ids = Object.keys(results || {}).filter((id) => results?.[id]);
    const existingIds = new Set(loadResultsIndexV3());
    const pendingWrites = [];

    for (const id of ids) {
      const slim = results[id];
      const existing = loadOneResultV3(id);

      if (existing?.totals && !sameLockedScore(existing, slim)) {
        console.error("[ResultsV3] bulk checkpoint refused score mutation", {
          gameId: id,
          existing: existing.totals,
          incoming: slim?.totals,
        });
        // Keep the caller's in-memory accumulator aligned with the canonical
        // locked result so the next UI checkpoint cannot display the rejected
        // score even temporarily.
        results[id] = existing;
        continue;
      }

      // Every normally simulated game is already written by
      // saveOneResultV3. The final checkpoint should repair missing rows, not
      // rewrite all 1,230 keys and amplify a near-quota failure.
      if (existing?.totals) {
        existingIds.add(id);
      } else {
        try {
          const compact = compactResultForCalendar(slim);
          const compressed = LZString.compressToUTF16(JSON.stringify(compact));
          try {
            localStorage.setItem(resultV3Key(id), compressed);
          } catch (writeError) {
            if (!isQuotaError(writeError)) throw writeError;
            clearNonCriticalQuotaCaches();
            localStorage.setItem(resultV3Key(id), compressed);
          }
          existingIds.add(id);
        } catch (error) {
          console.warn("[ResultsV3] failed saving compact checkpoint", id, error);
        }
      }

      if (persistBoxes && hasBoxRows(slim)) {
        pendingWrites.push(saveOneResultV3(id, slim, null, seasonYear));
      }
    }

    saveResultsIndexV3([...existingIds]);
    if (pendingWrites.length) await Promise.allSettled(pendingWrites);
  } catch (e) {
    console.error("[ResultsV3] bulk save failed", e);
  }
}


function countCompletedRegularSeasonGames(schedule, results) {
  let completed = 0;

  for (const games of Object.values(schedule || {})) {
    for (const g of games || []) {
      if (!g?.id) continue;
      if (g.played || hasUsableStoredResult(results?.[g.id])) completed += 1;
    }
  }

  return completed;
}

function snapshotLockedRegularSeasonGames(schedule, results) {
  const locked = {};

  for (const [date, games] of Object.entries(schedule || {})) {
    for (const game of games || []) {
      const result = results?.[game?.id];
      if (!game?.id || !hasUsableStoredResult(result)) continue;
      locked[game.id] = {
        date,
        home: game.home,
        away: game.away,
        homeScore: Number(result?.totals?.home ?? result?.winner?.home ?? 0),
        awayScore: Number(result?.totals?.away ?? result?.winner?.away ?? 0),
      };
    }
  }

  return locked;
}

function reconcileCompletedGamesWithCanonicalStorage(schedule, results) {
  const nextResults = { ...(results || {}) };
  const seenIds = new Map();
  const duplicates = [];

  for (const [date, games] of Object.entries(schedule || {})) {
    if (!Array.isArray(games)) continue;

    for (let index = 0; index < games.length; index += 1) {
      const game = games[index];
      if (!game?.id) continue;

      if (seenIds.has(game.id)) {
        duplicates.push({
          gameId: game.id,
          firstDate: seenIds.get(game.id),
          duplicateDate: date,
        });
        continue;
      }
      seenIds.set(game.id, date);

      const stored = loadOneResultV3(game.id);
      const memory = nextResults[game.id];
      const canonical = hasUsableStoredResult(stored)
        ? stored
        : hasUsableStoredResult(memory)
          ? memory
          : null;

      if (canonical) {
        nextResults[game.id] = canonical;
        if (!game.played) games[index] = { ...game, played: true };
      } else if (game.played) {
        // A played flag without an authoritative result is a ghost. Repair it
        // before simulation so the game can be simulated exactly once.
        games[index] = { ...game, played: false };
      }
    }
  }

  if (duplicates.length) {
    console.error("[Calendar integrity] duplicate regular-season game IDs", duplicates);
    throw new Error(
      `Season integrity protection found ${duplicates.length} duplicate game ID${duplicates.length === 1 ? "" : "s"}. Reset or regenerate the schedule before simulating.`
    );
  }

  return nextResults;
}

function assertLockedRegularSeasonGamesUnchanged(snapshot, schedule, results, label) {
  const currentLocation = new Map();
  for (const [date, games] of Object.entries(schedule || {})) {
    for (const game of games || []) {
      if (game?.id) currentLocation.set(game.id, { date, game });
    }
  }

  const mutations = [];
  for (const [gameId, before] of Object.entries(snapshot || {})) {
    const located = currentLocation.get(gameId);
    const result = results?.[gameId];
    const after = {
      date: located?.date,
      home: located?.game?.home,
      away: located?.game?.away,
      homeScore: Number(result?.totals?.home ?? result?.winner?.home ?? 0),
      awayScore: Number(result?.totals?.away ?? result?.winner?.away ?? 0),
    };

    if (
      !located ||
      !result ||
      before.date !== after.date ||
      before.home !== after.home ||
      before.away !== after.away ||
      before.homeScore !== after.homeScore ||
      before.awayScore !== after.awayScore
    ) {
      mutations.push({ gameId, before, after });
    }
  }

  if (mutations.length) {
    console.error(`[Calendar integrity] ${label}: locked games changed`, mutations);
    throw new Error(
      `Season integrity protection stopped the simulation because ${mutations.length} completed game${mutations.length === 1 ? "" : "s"} changed.`
    );
  }
}

function isRegularSeasonComplete(schedule, results) {
  let total = 0;
  let completed = 0;

  for (const games of Object.values(schedule || {})) {
    for (const g of games || []) {
      if (!g?.id) continue;
      total += 1;
      if (g.played || hasUsableStoredResult(results?.[g.id])) completed += 1;
    }
  }

  return total > 0 && completed === total;
}


function buildAwardDisplayStatsForStorage(combinedStats = {}) {
  const next = {};

  for (const [key, row] of Object.entries(combinedStats || {})) {
    if (!row?.player || !row?.team || Number(row?.gp || 0) <= 0) continue;
    if (!statRowHasRealProduction(row)) continue;

    next[key] = {
      ...row,
      _awardsOnly: true,
      _combinedForAwards: true,
      _combinedForAwardsAt: Date.now(),
    };
  }

  return next;
}

function saveAwardDisplayStats(combinedStats = {}) {
  const displayStats = buildAwardDisplayStatsForStorage(combinedStats);
  try {
    writeCompressedJson(AWARD_DISPLAY_STATS_KEY, displayStats);
  } catch (error) {
    console.warn("[Calendar] failed to save dedicated award display stats", error);
  }
  return displayStats;
}

function awardFallbackPerGame(row = {}, key) {
  const gp = Math.max(1, Number(row?.gp || 0));
  return Number((Number(row?.[key] || 0) / gp).toFixed(1));
}

function awardFallbackPct(made, attempts) {
  const a = Number(attempts || 0);
  if (!a) return 0;
  return Number(((Number(made || 0) / a) * 100).toFixed(1));
}

function buildCalendarAwardFallbackRow(row = {}, score = 0, extra = {}) {
  return {
    player: row.player,
    team: row.team,
    gp: Number(row.gp || 0),
    min: awardFallbackPerGame(row, "min"),
    pts: awardFallbackPerGame(row, "pts"),
    reb: awardFallbackPerGame(row, "reb"),
    ast: awardFallbackPerGame(row, "ast"),
    stl: awardFallbackPerGame(row, "stl"),
    blk: awardFallbackPerGame(row, "blk"),
    fgPct: awardFallbackPct(row.fgm, row.fga),
    tpPct: awardFallbackPct(row.tpm, row.tpa),
    ftPct: awardFallbackPct(row.ftm, row.fta),
    score: Number(Number(score || 0).toFixed(3)),
    ...extra,
  };
}

function buildFallbackSeasonAwards(playersArray = [], teamsWithWins = [], regularSeasonComplete = false) {
  const teamWins = new Map((teamsWithWins || []).map((team) => [team.team, Number(team.wins || 0)]));
  const pool = (playersArray || [])
    .filter((row) => Number(row?.gp || 0) >= (regularSeasonComplete ? 45 : 1))
    .filter(statRowHasRealProduction)
    .map((row) => ({
      ...row,
      _team_wins: Number(row?._team_wins ?? teamWins.get(row?.team) ?? 0),
      _ppg: awardFallbackPerGame(row, "pts"),
      _rpg: awardFallbackPerGame(row, "reb"),
      _apg: awardFallbackPerGame(row, "ast"),
      _spg: awardFallbackPerGame(row, "stl"),
      _bpg: awardFallbackPerGame(row, "blk"),
      _mpg: awardFallbackPerGame(row, "min"),
    }));

  if (!pool.length) return null;

  const max = (key, fallback = 1) => Math.max(...pool.map((row) => Number(row?.[key] || 0)), fallback);
  const maxPpg = max("_ppg");
  const maxRpg = max("_rpg");
  const maxApg = max("_apg");
  const maxSpg = max("_spg");
  const maxBpg = max("_bpg");
  const maxWins = max("_team_wins", 82);
  const maxOvr = max("overall", 99);
  const norm = (value, maximum) => maximum > 0 ? Math.max(0, Math.min(1, Number(value || 0) / maximum)) : 0;

  const scoreMvp = (row) =>
    0.31 * norm(row._ppg, maxPpg) +
    0.16 * norm(row._apg, maxApg) +
    0.14 * norm(row._rpg, maxRpg) +
    0.22 * norm(row._team_wins, maxWins) +
    0.075 * norm(row._spg, maxSpg) +
    0.075 * norm(row._bpg, maxBpg) +
    0.02 * norm(row.overall, maxOvr);

  const scoreDpoy = (row) =>
    0.36 * norm(row._spg, maxSpg) +
    0.36 * norm(row._bpg, maxBpg) +
    0.18 * norm(Number(row.def_rating || row.defRating || 0), 99) +
    0.10 * norm(row._team_wins, maxWins);

  const scoreSixth = (row) => {
    const starts = Number(row.started || 0);
    const benchGames = Math.max(0, Number(row.gp || 0) - starts);
    const benchShare = Number(row.gp || 0) > 0 ? benchGames / Number(row.gp || 1) : 0;
    if (row._mpg < 14 || benchShare <= 0.5) return -1;
    return 0.48 * norm(row._ppg, maxPpg) + 0.18 * norm(row._apg, maxApg) + 0.16 * norm(row._rpg, maxRpg) + 0.18 * benchShare;
  };

  const scoreMip = (row) => {
    const prev = row.mip_prev || row.mipPrev || row.previousSeasonStats || {};
    const prevGp = Number(prev.games ?? prev.gp ?? 0);
    if (prevGp > 0 && prevGp < 30) return -1;
    const prevPpg = Number(prev.ppg ?? prev.pts ?? 0);
    const prevRpg = Number(prev.rpg ?? prev.reb ?? 0);
    const prevApg = Number(prev.apg ?? prev.ast ?? 0);
    const prodGain = (row._ppg + row._rpg + row._apg) - (prevPpg + prevRpg + prevApg);
    return prodGain + Math.max(0, row._mpg - Number(prev.mpg || prev.min || 0)) * 0.15;
  };

  const isRotyEligible = (row) => {
    const priorGames = Number(row.priorCareerGames ?? row.careerGamesBeforeSeason ?? row.previousCareerGames ?? 0);
    const rookieFlag = row.rotyEligible || row.rookieEligible || row.isRookie || row.rookie;
    return priorGames <= 0 && (rookieFlag || Number(row.age || 99) <= 24);
  };

  const ranked = (scorer, extra = () => ({}), sourcePool = pool) => sourcePool
    .map((row) => ({ row, score: scorer(row) }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => buildCalendarAwardFallbackRow(entry.row, entry.score, extra(entry.row, entry.score)));

  const mvpRace = ranked(scoreMvp).slice(0, 10);
  const dpoyRace = ranked(scoreDpoy).slice(0, 10);
  const sixthRace = ranked(scoreSixth).slice(0, 10);
  const mipRace = ranked(scoreMip, (row) => {
    const prev = row.mip_prev || row.mipPrev || row.previousSeasonStats || {};
    return {
      mip_prev_ppg: Number(prev.ppg ?? prev.pts ?? 0),
      mip_ppg_delta: Number((row._ppg - Number(prev.ppg ?? prev.pts ?? 0)).toFixed(1)),
      mip_prod_delta: Number(((row._ppg + row._rpg + row._apg) - (Number(prev.ppg ?? prev.pts ?? 0) + Number(prev.rpg ?? prev.reb ?? 0) + Number(prev.apg ?? prev.ast ?? 0))).toFixed(1)),
    };
  }).slice(0, 10);
  const rotyRace = ranked(scoreMvp, () => ({}), pool.filter(isRotyEligible)).slice(0, 10);

  const allNba = ranked(scoreMvp).slice(0, 15);
  const allDef = ranked(scoreDpoy).slice(0, 10);

  return {
    season: seasonYear,
    fallback: true,
    fallbackReason: "JS final-awards fallback used because worker award result was missing or invalid.",
    mvp: mvpRace[0] || null,
    mvp_race: mvpRace,
    dpoy: dpoyRace[0] || mvpRace[0] || null,
    dpoy_race: dpoyRace,
    sixth_man: sixthRace[0] || mvpRace[0] || null,
    sixth_man_race: sixthRace,
    mip: mipRace[0] || mvpRace[0] || null,
    mip_race: mipRace,
    roty: rotyRace[0] || null,
    roty_race: rotyRace,
    all_nba_first: allNba.slice(0, 5),
    all_nba_second: allNba.slice(5, 10),
    all_nba_third: allNba.slice(10, 15),
    all_defensive_first: allDef.slice(0, 5),
    all_defensive_second: allDef.slice(5, 10),
    all_rookie_first: rotyRace.slice(0, 5),
    all_rookie_second: rotyRace.slice(5, 10),
  };
}


async function finalizeCompletedRegularSeasonPlayerCardsAfterAwards({ awards, schedule, results, activeTeams, playerStats }) {
  if (!isRegularSeasonComplete(schedule, results)) return null;

  const displaySeasonYear = Number(seasonYear || 0) + 1;
  if (!Number.isFinite(displaySeasonYear) || displaySeasonYear <= 1900) return null;

  try {
    // Keep the exact completed regular-season stat map available while the
    // player-card archive runs. Award-display helper rows can live in storage
    // too, but this guarantees the real season rows are archived before any
    // playoffs/offseason/dev transition has a chance to clear the live key.
    if (playerStats && Object.keys(playerStats || {}).length) {
      savePlayerStats(playerStats);
    }

    const seasonStartForArchive = displaySeasonYear - 1;
    const archiveRosterLeague = Array.isArray(activeTeams) && activeTeams.length
      ? { ...leagueData, teams: activeTeams }
      : leagueData;
    const withStatsArchive = ensureCompletedSeasonStatsArchive(
      leagueData,
      seasonStartForArchive,
      {
        // Use the exact in-memory completed-season stat map rather than hoping a
        // later transition can reconstruct it after storage cleanup.
        playerStatsMap: playerStats,
        rosterLeagueData: archiveRosterLeague,
      }
    );
    const withPlayerCards = archiveCurrentSeasonIntoPlayerCards(withStatsArchive, displaySeasonYear);

    const archivedYears = {
      ...(withPlayerCards.playerHistoryArchivedYears || {}),
      [String(displaySeasonYear)]: {
        displaySeasonYear,
        seasonStartYear: seasonStartForArchive,
        source: "Calendar.computeAndSaveCalendarAwards",
        archivedAt: new Date().toISOString(),
      },
    };
    const finalized = {
      ...withPlayerCards,
      playerHistoryArchivedYears: archivedYears,
    };

    setLeagueData(finalized);
    await saveLeagueData(finalized);

    if (typeof window !== "undefined" && window.__debugSimLogs) {
      console.log("[Calendar] finalized completed regular-season player-card history", {
        displaySeasonYear,
        seasonStartYear: seasonStartForArchive,
      });
    }

    return finalized;
  } catch (error) {
    console.warn("[Calendar] failed to finalize completed regular-season player-card history", error);
    return null;
  } finally {
    // Restore award-display rows for Awards/All-NBA UI after the archive uses
    // the real completed-season rows. This keeps cards correct without changing
    // the existing awards screen data source.
    try {
      const currentStats = playerStats && Object.keys(playerStats || {}).length ? playerStats : loadPlayerStats();
      const combinedCurrentRosterStats = buildCombinedAwardStatsForCurrentRosters(currentStats, activeTeams);
      saveAwardDisplayStats(combinedCurrentRosterStats);
    } catch {}
  }
}

async function computeAndSaveCalendarAwards({
  playerStats,
  schedule,
  results,
  activeTeams,
  gamesSimmed,
}) {
  try {
    let currentStats =
      playerStats && Object.keys(playerStats || {}).length
        ? playerStats
        : loadPlayerStats();

    const regularSeasonComplete = isRegularSeasonComplete(schedule, results);
    if (regularSeasonComplete) {
      const rebuilt = await rebuildPlayerSeasonStatsFromCanonicalBoxScores(schedule, results);
      const best = chooseBestStatsForAwards([
        { source: "live-player-stats", stats: currentStats, clutchStats: loadClutchStats(seasonYear) },
        { source: "canonical-box-score-rebuild", stats: rebuilt.stats, clutchStats: rebuilt.clutchStats },
      ]);

      if (best?.stats) {
        currentStats = best.stats;
        savePlayerStats(currentStats);
        if (best.clutchStats) saveClutchStats(best.clutchStats);
        console.log("[Calendar] selected final award stat source:", {
          source: best.source,
          eligible: best.eligible,
          realRows: best.realRows,
          processedGames: rebuilt.processedGames,
          expectedGames: rebuilt.expectedGames,
          memoryFallbackGames: rebuilt.memoryFallbackGames || 0,
        });
      }

      if (!(rebuilt.expectedGames > 0 && rebuilt.processedGames === rebuilt.expectedGames)) {
        console.warn("[Calendar] final stats rebuild had missing box scores; using best available player-stat source", {
          processedGames: rebuilt.processedGames,
          expectedGames: rebuilt.expectedGames,
          memoryFallbackGames: rebuilt.memoryFallbackGames || 0,
          missingGameIds: rebuilt.missingGameIds.slice(0, 20),
        });
      }
    }

    const combinedCurrentRosterStats = buildCombinedAwardStatsForCurrentRosters(currentStats, activeTeams);
    saveAwardDisplayStats(combinedCurrentRosterStats);

    const eligiblePlayerCount = getAwardEligiblePlayerCount(combinedCurrentRosterStats);
    if (regularSeasonComplete && eligiblePlayerCount === 0) {
      throw new Error(
        "Regular-season results are complete, but no player has the 65 games required for awards. Player stats could not be reconciled from box scores."
      );
    }

    const defMap = {};
    for (const t of activeTeams || []) {
      const teamName = t?.name || t?.team;
      for (const pl of t?.players || []) {
        const playerName = pl?.name || pl?.player;

        const def =
          pl?.def_rating ??
          pl?.defRating ??
          pl?.defensive_rating ??
          pl?.defensiveRating ??
          pl?.drtg ??
          pl?.defrtg;

        if (playerName && teamName && def != null && Number.isFinite(Number(def))) {
          defMap[`${playerName}__${teamName}`] = Number(def);
        }
      }
    }

    const rookieMetaMap = buildAwardRosterMetaLookup(activeTeams, seasonYear + 1);

    const playersArray = Object.values(combinedCurrentRosterStats || {}).map((p) => {
      const key = `${p.player}__${p.team}`;
      const def = defMap[key];
      const rookieMeta = rookieMetaMap[key] || {};
      return {
        ...p,
        ...rookieMeta,
        def_rating: Number.isFinite(Number(def)) ? Number(def) : 110,
      };
    });

    console.log("[Calendar] computing awards from combined sim-to-date stats for", playersArray.length, "players");

    const teamsWithWins = buildTeamsWithWinsForAwards(activeTeams, schedule, results);

    const deepUnpair = (x) => {
      if (Array.isArray(x) && x.length && Array.isArray(x[0]) && x[0].length === 2) {
        return Object.fromEntries(x.map(([k, v]) => [k, deepUnpair(v)]));
      }
      if (Array.isArray(x)) return x.map(deepUnpair);
      return x;
    };

    let awardsError = null;
    let baseAwards = {};
    try {
      const awardsRaw = await computeSeasonAwards(playersArray, {
        seasonYear,
        gamesSimmed,
        teams: teamsWithWins,
      });
      baseAwards = deepUnpair(awardsRaw) || {};
    } catch (error) {
      awardsError = error;
      console.warn("[Calendar] Python awards worker failed; attempting JS fallback", error);
    }

    const clutchAwards = computeClutchAwardResults(
      loadClutchStats(seasonYear),
      { teams: activeTeams || [] },
      { final: regularSeasonComplete }
    );
    const fallbackAwards =
      regularSeasonComplete && eligiblePlayerCount > 0 && (!baseAwards?.mvp || awardsError)
        ? buildFallbackSeasonAwards(playersArray, teamsWithWins, regularSeasonComplete)
        : null;

    const awards = {
      ...(fallbackAwards || {}),
      ...baseAwards,
      ...clutchAwards,
    };

    if (!awards.mvp && fallbackAwards?.mvp) awards.mvp = fallbackAwards.mvp;
    if (!awards.mvp_race?.length && fallbackAwards?.mvp_race?.length) awards.mvp_race = fallbackAwards.mvp_race;

    if (regularSeasonComplete && eligiblePlayerCount > 0 && !awards?.mvp) {
      throw new Error(
        awardsError?.message || "Awards calculation returned no MVP despite having eligible players."
      );
    }

    if (fallbackAwards?.mvp) {
      console.warn("[Calendar] saved season awards using JS fallback", {
        seasonYear,
        eligiblePlayerCount,
        workerHadMvp: Boolean(baseAwards?.mvp),
        workerError: awardsError?.message || null,
      });
    }

    const persistAwards = () => {
      // bm_awards_latest was an identical second copy with no readers. Keeping
      // only the canonical key avoids wasting quota at the exact season gate.
      localStorage.removeItem("bm_awards_latest");
      localStorage.setItem("bm_awards_v1", JSON.stringify(awards));
    };

    try {
      persistAwards();
    } catch (storageError) {
      if (!isQuotaError(storageError)) throw storageError;

      console.warn("[Calendar] awards save hit localStorage quota; running recovery", storageError);
      reconcileResultStoreV3WithSchedule(schedule);
      for (const id of loadResultsIndexV3()) loadOneResultV3(id);
      clearNonCriticalQuotaCaches();
      saveAwardDisplayStats(combinedCurrentRosterStats);
      persistAwards();
    }

    appendPlayerMoodEvents(buildAwardMoodEvents(awards, focusedDate || fmt(seasonEnd)));
    await finalizeCompletedRegularSeasonPlayerCardsAfterAwards({
      awards,
      schedule,
      results,
      activeTeams,
      playerStats: currentStats,
    });
    return awards;
  } catch (e) {
    console.error("[Calendar] awards computation failed after sim-to-date:", e);
    return null;
  }
}














  /* -------------------------------------------------------------------------- */
  /*                          Schedule + Results Loader                         */
  /* -------------------------------------------------------------------------- */
  /* -------------------------------------------------------------------------- */
  /*                          Schedule + Results Loader                         */
  /* -------------------------------------------------------------------------- */
const scheduleTeamIdentitySignature = useMemo(
  () =>
    (teams || [])
      .map((team) => `${slugifyId(team?.name)}:${resolveTeamDivision(team, team?.conference || team?.conf || "")}`)
      .filter(Boolean)
      .sort()
      .join("|"),
  [teams]
);

const scheduleSeasonIdentity = `${fmt(seasonStart)}::${fmt(seasonEnd)}`;

useEffect(() => {
  if (!teams || teams.length < 2) return;

  const wantStart = fmt(seasonStart);
  const wantEnd = fmt(seasonEnd);
  const canonicalIds = teams.map((t) => slugifyId(t.name));
  const target = 82;

  const isScheduleValid = (obj) => {
    try {
      if (!obj || !Object.keys(obj).length) return false;

      const keys = Object.keys(obj).sort();
      if (keys[0] !== wantStart || keys[keys.length - 1] !== wantEnd) return false;

      const cnt = Object.fromEntries(canonicalIds.map((id) => [id, 0]));
      for (const games of Object.values(obj)) {
        for (const g of games) {
          if (!g.homeId || !g.awayId) return false;
          if (!cnt.hasOwnProperty(g.homeId)) return false;
          if (!cnt.hasOwnProperty(g.awayId)) return false;

          cnt[g.homeId]++;
          cnt[g.awayId]++;
        }
      }

      return canonicalIds.every((id) => cnt[id] === target);
    } catch {
      return false;
    }
  };

  // ----- load from storage -----
  let parsedSched = {};
  let parsedResults = {};
  let parsedPlayerStats = loadPlayerStats();

  try {
    parsedSched = JSON.parse(localStorage.getItem(SCHED_KEY)) || {};
  } catch {
    parsedSched = {};
  }

  const storedScheduleHasGamesBeforeLoad = Object.values(parsedSched || {}).some(
    (games) => Array.isArray(games) && games.some((game) => game?.id)
  );
  let generatedScheduleForRecovery = null;

  if (!storedScheduleHasGamesBeforeLoad) {
    generatedScheduleForRecovery = generateFullSeasonSchedule(
      teams,
      seasonStart,
      seasonEnd,
      seasonCalendarConfig
    ).byDate;
  }

  // Repair the result index and delete prior-season/orphan payloads against the
  // current season's actual schedule. When the schedule key is missing, reuse
  // this freshly generated schedule later so random schedule generation cannot
  // disagree with the recovery pass.
  reconcileResultStoreV3WithSchedule(
    storedScheduleHasGamesBeforeLoad ? parsedSched : generatedScheduleForRecovery
  );
  parsedResults = loadResults();

  const scheduleValid = isScheduleValid(parsedSched);
  const storedScheduleKeys = Object.keys(parsedSched || {}).sort();
  const storedScheduleLooksLikeDifferentSeason =
    storedScheduleKeys.length > 0 &&
    (storedScheduleKeys[0] !== wantStart ||
      storedScheduleKeys[storedScheduleKeys.length - 1] !== wantEnd);

  if (!scheduleValid && storedScheduleLooksLikeDifferentSeason) {
    clearAllResultsV3();
    removeLegacyResultsBlob();
    localStorage.removeItem(PLAYER_STATS_KEY);
    localStorage.removeItem(PENDING_SIM_INTENT_KEY);
    setPendingSimIntent(null);
    localStorage.removeItem("bm_awards_latest");
    localStorage.removeItem("bm_awards_v1");
    localStorage.removeItem(AWARD_DISPLAY_STATS_KEY);
    localStorage.removeItem(CLUTCH_STATS_KEY);
    parsedResults = {};
    parsedPlayerStats = {};
  }

  const hasValidResults = Object.values(parsedResults).some(
    (r) => r?.totals?.home != null && r?.totals?.away != null
  );

  const hasPlayerStats = parsedPlayerStats && Object.keys(parsedPlayerStats).length > 0;
  const hasRoleFields =
    parsedPlayerStats &&
    Object.values(parsedPlayerStats).some((p) => p && (("started" in p) || ("sixth" in p)));
  const parsedClutchStats = loadClutchStats(seasonYear);
  const hasClutchStats = Boolean(
    Object.keys(parsedClutchStats?.players || {}).length ||
      (parsedClutchStats?.processedGameIds || []).length
  );
  let clutchBackfillStarted = false;

  const maybeBackfillClutchStats = (scheduleForBackfill) => {
    if (!hasValidResults || hasClutchStats || clutchBackfillStarted) return;
    clutchBackfillStarted = true;

    rebuildPlayerSeasonStatsFromCanonicalBoxScores(scheduleForBackfill, parsedResults)
      .then((rebuilt) => {
        if (rebuilt?.processedGames > 0) {
          saveClutchStats(rebuilt.clutchStats);
          console.log(
            "[CPOTY] backfilled clutch history from stored box scores:",
            rebuilt.processedGames,
            "games"
          );
        }
      })
      .catch((error) => {
        console.warn("[CPOTY] could not backfill stored clutch history", error);
      });
  };

  const storedScheduleHasGames = storedScheduleHasGamesBeforeLoad;

  // A completed season schedule is immutable. Roster trades and other league-data
  // changes must never cause previously played games to be regenerated or moved.
  // If the stored schedule belongs to this season and already has results, preserve
  // it even if a legacy validation rule no longer considers it perfectly shaped.
  if (
    !scheduleValid &&
    !storedScheduleLooksLikeDifferentSeason &&
    storedScheduleHasGames &&
    hasValidResults
  ) {
    console.error(
      "[Calendar] preserving same-season schedule with completed results instead of regenerating it"
    );
    const hydrated = hydrateSchedulePlayedFlagsFromResults(parsedSched, parsedResults);
    setScheduleByDate(hydrated.schedule);
    setResultsById(parsedResults);

    if (!hasPlayerStats || !hasRoleFields) {
      recomputePlayerSeasonStatsFromResults(hydrated.schedule, parsedResults);
    }
    maybeBackfillClutchStats(hydrated.schedule);
    return;
  }

  // ✅ IMPORTANT: if schedule is missing/invalid, regenerate it EVEN IF results exist
  if (!scheduleValid) {
    const byDate =
      generatedScheduleForRecovery ||
      generateFullSeasonSchedule(teams, seasonStart, seasonEnd, seasonCalendarConfig).byDate;

    const hydrated = hydrateSchedulePlayedFlagsFromResults(byDate, parsedResults);
    const rebuilt = hydrated.schedule;

    if (hydrated.hydratedCount > 0) {
      console.log("[Calendar] restored played flags from stored results:", hydrated.hydratedCount);
    }

    saveSchedule(rebuilt);          // writes storage + sets state
    setResultsById(parsedResults);  // keep results if they exist

    if (hasValidResults && (!hasPlayerStats || !hasRoleFields)) {
      const rebuiltStats = recomputePlayerSeasonStatsFromResults(rebuilt, parsedResults);
      console.log("[Calendar] auto-rebuilt player stats (role-aware); players =", Object.keys(rebuiltStats).length);
    }

    maybeBackfillClutchStats(rebuilt);
    return;
  }

  // ----- normal path: reuse stored schedule -----
  const hydrated = hydrateSchedulePlayedFlagsFromResults(parsedSched, parsedResults);
  const scheduleToUse = hydrated.schedule;

  if (hydrated.changed) {
    console.log("[Calendar] restored played flags from stored results:", hydrated.hydratedCount);
    saveSchedule(scheduleToUse);
  } else {
    setScheduleByDate(scheduleToUse);
  }

  setResultsById(parsedResults);

  if (hasValidResults && (!hasPlayerStats || !hasRoleFields)) {
    const rebuiltStats = recomputePlayerSeasonStatsFromResults(parsedSched, parsedResults);
    console.log("[Calendar] auto-rebuilt player stats (role-aware); players =", Object.keys(rebuiltStats).length);
  }
  maybeBackfillClutchStats(scheduleToUse);
}, [scheduleTeamIdentitySignature, scheduleSeasonIdentity]);




  /* -------------------------------------------------------------------------- */
  /*                                My Team Games                               */
  /* -------------------------------------------------------------------------- */
  const myGames = useMemo(() => {
    if (!calendarViewTeam) return {};

    const myId = slugifyId(calendarViewTeam.name);
    const map = {};

    for (const [d, games] of Object.entries(scheduleByDate)) {
      const matches = games.filter(
        (g) => g.homeId === myId || g.awayId === myId
      );

      if (matches.length === 1) map[d] = matches[0];
      else if (matches.length > 1) map[d] = matches[matches.length - 1];
    }

    return map;
  }, [scheduleByDate, calendarViewTeam]);

  /* -------------------------------------------------------------------------- */
  /*                                 Focused Date                               */
  /* -------------------------------------------------------------------------- */
  const [focusedDate, setFocusedDate] = useState(null);
  const monthRefs = useRef({});
  const calendarScrollRef = useRef(null);
  const restoredCursorRef = useRef(false);
  const restoredCursorKeyRef = useRef("");

  const readCalendarCursor = () => {
    try {
      const raw = localStorage.getItem(CALENDAR_CURSOR_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      return saved && typeof saved === "object" ? saved : null;
    } catch {
      return null;
    }
  };

  const saveCalendarMoodContext = (dateStr, monthStr = null) => {
    if (!dateStr) return;

    try {
      const resolvedMonth =
        monthStr || (dateStr ? monthKey(new Date(dateStr)) : monthKey(seasonStart));

      localStorage.setItem(
        CALENDAR_MOOD_CONTEXT_KEY,
        JSON.stringify({
          date: dateStr,
          currentDate: dateStr,
          month: resolvedMonth,
          seasonYear,
          teamName: calendarViewTeam?.name || selectedTeam?.name || "",
          updatedAt: Date.now(),
        })
      );
    } catch {}
  };

  const saveCalendarCursor = (dateStr, monthStr = null) => {
    try {
      const resolvedMonth =
        monthStr || (dateStr ? monthKey(new Date(dateStr)) : monthKey(seasonStart));

      localStorage.setItem(
        CALENDAR_CURSOR_KEY,
        JSON.stringify({
          date: dateStr || null,
          month: resolvedMonth,
        })
      );

      saveCalendarMoodContext(dateStr, resolvedMonth);
    } catch {}
  };

  const getLastPlayedDateFromSchedule = (schedule) => {
    const dates = Object.keys(schedule || {}).sort();
    let lastPlayedDate = null;

    for (const date of dates) {
      const games = schedule?.[date] || [];
      if (games.some((g) => g?.played)) {
        lastPlayedDate = date;
      }
    }

    return lastPlayedDate;
  };

  const getNextCalendarDateString = (dateStr) => {
    const parsed = parseCalendarDate(dateStr);
    if (!parsed) return fmt(seasonStart);
    return fmt(addDays(parsed, 1));
  };

  const readSimulationCursorDate = () => {
    const seasonStartStr = fmt(seasonStart);
    try {
      const raw = localStorage.getItem(CALENDAR_SIM_CURSOR_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const date = typeof parsed === "string" ? parsed : parsed?.date;
      if (date && parseCalendarDate(date)) return date < seasonStartStr ? seasonStartStr : date;
    } catch {}
    return seasonStartStr;
  };

  const saveSimulationCursorDate = (dateStr) => {
    if (!dateStr) return;
    try {
      const seasonStartStr = fmt(seasonStart);
      const parsed = parseCalendarDate(dateStr);
      const nextDate = parsed ? fmt(parsed) : seasonStartStr;
      const resolvedDate = nextDate < seasonStartStr ? seasonStartStr : nextDate;
      localStorage.setItem(
        CALENDAR_SIM_CURSOR_KEY,
        JSON.stringify({
          date: resolvedDate,
          seasonYear,
          updatedAt: Date.now(),
        })
      );
      writeLeagueClock({
        date: resolvedDate,
        phase: "regularSeason",
        seasonYear,
        source: "calendar",
      });
    } catch {}
  };

  /* -------------------------------------------------------------------------- */
  /*                              Month & Visible Days                           */
  /* -------------------------------------------------------------------------- */
  const [month, setMonth] = useState(() => {
    const saved = readCalendarCursor();
    if (saved?.month) return saved.month;

    return monthKey(seasonStart);
  });

  const months = useMemo(
    () => Array.from(new Set(allDays.map(monthKey))),
    [allDays]
  );

  const scrollCalendarToMonth = (monthStr, behavior = "smooth") => {
    requestAnimationFrame(() => {
      const container = calendarScrollRef.current;
      const el = monthRefs.current[monthStr];

      if (!container || !el) return;

      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const top = container.scrollTop + (elRect.top - containerRect.top);

      container.scrollTo({
        top: Math.max(0, top),
        behavior,
      });
    });
  };

  useEffect(() => {
    const dates = Object.keys(myGames).sort();
    const restoreKey = `${CALENDAR_CURSOR_KEY}|${calendarViewTeam?.name || ""}`;

    if (restoredCursorKeyRef.current !== restoreKey) {
      restoredCursorKeyRef.current = restoreKey;
      restoredCursorRef.current = false;
    }

    if (!dates.length) {
      const fallbackDate = fmt(seasonStart);
      setFocusedDate((prev) => prev || fallbackDate);
      setMonth((prev) => prev || monthKey(seasonStart));
      return;
    }

    // Important: only restore/scroll once per team-season page load.
    // During live simulation, scheduleByDate updates many times, which changes
    // myGames. Re-running scroll restore on every update was pulling the page
    // down into the calendar and making the header feel stuck off-screen.
    if (restoredCursorRef.current) {
      setFocusedDate((prev) => prev || dates[0] || fmt(seasonStart));
      return;
    }

    restoredCursorRef.current = true;

    const saved = readCalendarCursor();
    const firstUnplayedDate =
      dates.find((date) => myGames[date] && !myGames[date].played) || dates[0];
    const savedDateIsValid = saved?.date && myGames[saved.date];
    const targetDate = savedDateIsValid ? saved.date : firstUnplayedDate;
    const targetMonth =
      saved?.month && months.includes(saved.month)
        ? saved.month
        : monthKey(new Date(targetDate || seasonStart));

    setFocusedDate(targetDate || fmt(seasonStart));
    setMonth(targetMonth);
    scrollCalendarToMonth(targetMonth, "auto");
  }, [myGames, seasonStart, CALENDAR_CURSOR_KEY, calendarViewTeam?.name, months]);

const scrollToMonth = (monthStr) => {
  setMonth(monthStr);
  saveCalendarCursor(focusedDate, monthStr);
  scrollCalendarToMonth(monthStr, "smooth");
};

useEffect(() => {
  if (focusedDate) saveCalendarMoodContext(focusedDate, month);
}, [focusedDate, month, seasonYear, calendarViewTeam?.name, selectedTeam?.name]);

const buildVisibleDaysForMonth = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);

  const isSeasonStartMonth =
    y === seasonStart.getFullYear() &&
    m - 1 === seasonStart.getMonth();

  if (isSeasonStartMonth) {
    const compactStart = addDays(seasonStart, -seasonStart.getDay());
    const compactDays = rangeDays(compactStart, last);
    const padded = [...compactDays];

    while (padded.length % 7 !== 0) padded.push(null);
    return padded;
  }

  const days = rangeDays(first, last);
  const pad = first.getDay();

  const padded = Array(pad).fill(null).concat(days);
  while (padded.length % 7 !== 0) padded.push(null);
  return padded;
};

const visibleDaysByMonth = useMemo(() => {
  const out = {};
  for (const monthStr of months) {
    out[monthStr] = buildVisibleDaysForMonth(monthStr);
  }
  return out;
}, [months, seasonStart]);

  /* -------------------------------------------------------------------------- */
  /*                                 Action Modals                               */
  /* -------------------------------------------------------------------------- */
const [boxModal, setBoxModal] = useState(null);
const [actionModal, setActionModal] = useState(null);
const [simErrorModal, setSimErrorModal] = useState(null);
const [simLock, setSimLock] = useState(false);
const simLockRef = useRef(false);

const [allStarPromptOpen, setAllStarPromptOpen] = useState(false);
const [allStarOpen, setAllStarOpen] = useState(false);
const [allStarData, setAllStarData] = useState(null);
const [tradeDeadlinePromptOpen, setTradeDeadlinePromptOpen] = useState(false);
const [contractExtensionPromptOpen, setContractExtensionPromptOpen] = useState(false);
const [contractExtensionPromptInfo, setContractExtensionPromptInfo] = useState(null);
const [contractExtensionDeadlineBusy, setContractExtensionDeadlineBusy] = useState(false);
const [tradeToasts, setTradeToasts] = useState([]);
const [pendingSimIntent, setPendingSimIntent] = useState(() => readPendingSimulationIntent());
const [injuryAlertModal, setInjuryAlertModal] = useState(null);

const persistPendingSimIntent = (intent) => {
  const next = writePendingSimulationIntent(intent);
  setPendingSimIntent(next);
  return next;
};

const clearPendingSimIntent = () => {
  writePendingSimulationIntent(null);
  setPendingSimIntent(null);
};


const shouldPauseForUserInjuryEvents = (events = [], intent = null) => {
  const injurySettings = normalizeInjurySettings(leagueData?.settings?.injuries);
  if (!injurySettings.enabled || !injurySettings.userAlerts || !selectedTeam?.name) return false;
  const userEvents = (events || []).filter((event) => event?.teamName === selectedTeam.name);
  if (!userEvents.length) return false;

  if (intent) persistPendingSimIntent({ ...intent, pausedReason: "injury_alert", seasonYear });
  setInjuryAlertModal({ events: userEvents, intent, createdAt: Date.now() });
  return true;
};

const refreshInjuryTouchedTeams = (activeLeagueData, touchedTeamNames = []) => {
  if (!touchedTeamNames?.length) return null;
  setLeagueData(structuredClone(activeLeagueData));
  const nextTeams = buildTeamsFromLeagueForSim(activeLeagueData);
  return {
    teams: nextTeams,
    runtime: buildSimulationRuntime(activeLeagueData, nextTeams),
  };
};

const ALL_STAR_DATE = seasonCalendarConfig.allStarSelectionDate || fmt(new Date(seasonYear + 1, 1, 13));
const ALL_STAR_HANDLED_KEY = `bm_all_star_handled_v1_${seasonYear}`;
const allStarHandledRef = useRef(localStorage.getItem(ALL_STAR_HANDLED_KEY) === "true");

const ROOKIE_EXTENSION_DEADLINE_DATE =
  seasonCalendarConfig.rookieExtensionDeadlineDate ||
  seasonCalendarConfig.contractExtensionDeadlineDate ||
  fmt(new Date(seasonYear, 9, 20));
const VETERAN_EXTENSION_DEADLINE_DATE =
  seasonCalendarConfig.veteranExtensionDeadlineDate ||
  fmt(new Date(seasonYear + 1, 2, 31));
const CONTRACT_EXTENSION_DEADLINE_DATE = ROOKIE_EXTENSION_DEADLINE_DATE;
const ROOKIE_EXTENSION_DEADLINE_HANDLED_KEY = `bm_rookie_extension_deadline_handled_v1_${seasonYear}`;
const VETERAN_EXTENSION_DEADLINE_HANDLED_KEY = `bm_veteran_extension_deadline_handled_v1_${seasonYear}`;
const CONTRACT_EXTENSION_DEADLINE_HANDLED_KEY = ROOKIE_EXTENSION_DEADLINE_HANDLED_KEY;
const rookieExtensionDeadlineHandledRef = useRef(
  localStorage.getItem(ROOKIE_EXTENSION_DEADLINE_HANDLED_KEY) === "true"
);
const veteranExtensionDeadlineHandledRef = useRef(
  localStorage.getItem(VETERAN_EXTENSION_DEADLINE_HANDLED_KEY) === "true"
);
const contractExtensionDeadlineHandledRef = rookieExtensionDeadlineHandledRef;

function getContractExtensionDeadlineInfo(dateStrOrType) {
  if (dateStrOrType === "rookie" || dateStrOrType === ROOKIE_EXTENSION_DEADLINE_DATE) {
    return {
      type: "rookie",
      phase: "rookie_deadline",
      date: ROOKIE_EXTENSION_DEADLINE_DATE,
      label: "Rookie Extension Deadline",
      title: "Final day for rookie-scale extensions",
      handledRef: rookieExtensionDeadlineHandledRef,
      handledKey: ROOKIE_EXTENSION_DEADLINE_HANDLED_KEY,
    };
  }
  if (dateStrOrType === "veteran" || dateStrOrType === VETERAN_EXTENSION_DEADLINE_DATE) {
    return {
      type: "veteran",
      phase: "veteran_deadline",
      date: VETERAN_EXTENSION_DEADLINE_DATE,
      label: "Veteran Extension Deadline",
      title: "Final day for veteran extensions",
      handledRef: veteranExtensionDeadlineHandledRef,
      handledKey: VETERAN_EXTENSION_DEADLINE_HANDLED_KEY,
    };
  }
  return null;
}

function openContractExtensionDeadlinePrompt(dateStrOrType = null) {
  const info = getContractExtensionDeadlineInfo(dateStrOrType || ROOKIE_EXTENSION_DEADLINE_DATE);
  setActionModal(null);
  setBoxModal(null);
  setContractExtensionPromptInfo(info);
  setContractExtensionPromptOpen(true);
}

function markContractExtensionDeadlineHandled(dateStrOrType = null) {
  const info = getContractExtensionDeadlineInfo(dateStrOrType || contractExtensionPromptInfo?.type || ROOKIE_EXTENSION_DEADLINE_DATE);
  if (!info) return;
  try {
    localStorage.setItem(info.handledKey, "true");
  } catch {}
  info.handledRef.current = true;
}

function shouldPauseForContractExtensionDeadline(dateStr) {
  const info = getContractExtensionDeadlineInfo(dateStr);
  return Boolean(info && !info.handledRef.current);
}

async function processContractExtensionDeadline({ closeWindow = false, deadlineType = null } = {}) {
  if (!leagueData || !selectedTeam?.name) return leagueData;
  const info = getContractExtensionDeadlineInfo(deadlineType || contractExtensionPromptInfo?.type || ROOKIE_EXTENSION_DEADLINE_DATE);
  if (!info) return leagueData;
  setContractExtensionDeadlineBusy(true);
  try {
    const result = closeWindow
      ? await closeContractExtensionWindow(
          leagueData,
          selectedTeam.name,
          info.date,
          info.phase
        )
      : await processCpuContractExtensions(
          leagueData,
          selectedTeam.name,
          info.phase,
          info.date
        );
    if (result?.ok && result?.leagueData) {
      setLeagueData(result.leagueData);
      return result.leagueData;
    }
    if (result && !result.ok) {
      throw new Error(result.reason || "Contract extension deadline processing failed.");
    }
    return leagueData;
  } finally {
    setContractExtensionDeadlineBusy(false);
  }
}

const TRADE_DEADLINE_DATE = seasonCalendarConfig.tradeDeadlineDate || fmt(new Date(seasonYear + 1, 1, 4));
const TRADE_DEADLINE_STATUS_KEY = "bm_trade_deadline_status_v1";
const TRADE_DEADLINE_HANDLED_KEY = `bm_trade_deadline_handled_v1_${seasonYear}`;
const tradeDeadlineHandledRef = useRef(
  localStorage.getItem(TRADE_DEADLINE_HANDLED_KEY) === "true"
);

function writeTradeDeadlineStatus(updates = {}) {
  try {
    const existing = JSON.parse(
      localStorage.getItem(TRADE_DEADLINE_STATUS_KEY) || "{}"
    );

    localStorage.setItem(
      TRADE_DEADLINE_STATUS_KEY,
      JSON.stringify({
        ...existing,
        seasonYear,
        deadlineDate: TRADE_DEADLINE_DATE,
        locked: false,
        ...updates,
      })
    );
  } catch {}
}

function refreshTradeDeadlineLockFromSchedule(schedule) {
  const lastPlayedDate = getLastPlayedDateFromSchedule(schedule);
  const locked = Boolean(lastPlayedDate && lastPlayedDate > TRADE_DEADLINE_DATE);

  writeTradeDeadlineStatus({
    locked,
    lastPlayedDate: lastPlayedDate || null,
    lockedAt: locked ? Date.now() : null,
    deadlineDayOfferOpen: locked ? false : undefined,
    offerWindowOpen: locked ? false : undefined,
    phase: locked ? "after_deadline" : undefined,
  });

  return locked;
}

function openTradeDeadlinePrompt() {
  writeTradeDeadlineStatus({
    locked: false,
    lastOfferDate: TRADE_DEADLINE_DATE,
    promptOpen: true,
    deadlineDayOfferOpen: true,
    offerWindowOpen: true,
    phase: "deadline_day",
    promptedAt: Date.now(),
  });

  setActionModal(null);
  setBoxModal(null);
  setTradeDeadlinePromptOpen(true);
}

function markTradeDeadlinePromptHandled(choice = "continue") {
  try {
    localStorage.setItem(TRADE_DEADLINE_HANDLED_KEY, "true");
  } catch {}

  tradeDeadlineHandledRef.current = true;
  const makeTrades = choice === "trade_center";
  writeTradeDeadlineStatus({
    locked: false,
    promptOpen: false,
    promptHandled: true,
    promptChoice: choice,
    deadlineDayOfferOpen: makeTrades,
    offerWindowOpen: makeTrades,
    phase: makeTrades ? "deadline_day_open" : "deadline_day_continue",
    promptedAt: Date.now(),
  });
}

function shouldPauseForTradeDeadline(dateStr) {
  return Boolean(
    userTradeDeadlineEnabled &&
      dateStr === TRADE_DEADLINE_DATE &&
      !tradeDeadlineHandledRef.current
  );
}

useEffect(() => {
  allStarHandledRef.current = localStorage.getItem(ALL_STAR_HANDLED_KEY) === "true";

  try {
    const savedAllStars = JSON.parse(localStorage.getItem("bm_all_stars_v1") || "null");
    if (savedAllStars?.season === `${seasonYear}-${seasonYear + 1}`) {
      if (savedAllStars?.all_star_version === ALL_STAR_LOGIC_VERSION) {
        setAllStarData(savedAllStars);
      } else {
        localStorage.removeItem("bm_all_stars_v1");
        localStorage.removeItem(ALL_STAR_HANDLED_KEY);
        allStarHandledRef.current = false;
        setAllStarData(null);
      }
    }
  } catch {}
}, [ALL_STAR_HANDLED_KEY, seasonYear]);

useEffect(() => {
  tradeDeadlineHandledRef.current =
    localStorage.getItem(TRADE_DEADLINE_HANDLED_KEY) === "true";

  refreshTradeDeadlineLockFromSchedule(scheduleByDate);
}, [TRADE_DEADLINE_HANDLED_KEY, TRADE_DEADLINE_DATE, scheduleByDate]);

useEffect(() => {
  if (userTradeDeadlineEnabled || !tradeDeadlinePromptOpen) return;
  setTradeDeadlinePromptOpen(false);
}, [tradeDeadlinePromptOpen, userTradeDeadlineEnabled]);

useEffect(() => {
  rookieExtensionDeadlineHandledRef.current =
    localStorage.getItem(ROOKIE_EXTENSION_DEADLINE_HANDLED_KEY) === "true";
  veteranExtensionDeadlineHandledRef.current =
    localStorage.getItem(VETERAN_EXTENSION_DEADLINE_HANDLED_KEY) === "true";
}, [ROOKIE_EXTENSION_DEADLINE_HANDLED_KEY, VETERAN_EXTENSION_DEADLINE_HANDLED_KEY]);

useEffect(() => {
  const stored = readPendingSimulationIntent();
  if (stored && Number(stored.seasonYear) !== Number(seasonYear)) {
    clearPendingSimIntent();
  } else if (stored) {
    setPendingSimIntent(stored);
  }
}, [seasonYear]);

// ✅ stop control
const stopRef = useRef(false);
const [stopRequested, setStopRequested] = useState(false);
const [showWestStandings, setShowWestStandings] = useState(true);
const [showEastStandings, setShowEastStandings] = useState(true);
const [showAwardsPanel, setShowAwardsPanel] = useState(false);
const [miniAwardTab, setMiniAwardTab] = useState("mvp");
const CALENDAR_SCALE = 1;

const acquireSimRunLock = (label = "simulation") => {
  if (simLockRef.current || simLock) {
    console.log(`[Sim] ${label} blocked: simulation already running`);
    return false;
  }
  simLockRef.current = true;
  setSimLock(true);
  return true;
};

const releaseSimRunLock = () => {
  simLockRef.current = false;
  setSimLock(false);
};

const openSimError = (message, title = "Cannot simulate") => {
  setSimErrorModal({ title, message });
};

const requestStop = () => {
  if (!simLock) return;
  stopRef.current = true;
  setStopRequested(true);
  console.log("[Sim] stop requested");
};

const handleTradeDeskEntries = (entries = []) => {
  if (!Array.isArray(entries) || !entries.length) return [];

  const feedStartedAt = cpuTradeNow();
  const savedFeed = appendTradeDeskEntries(entries);
  appendTradeDeskMoodEventsFromEntries(entries, {
    currentDate:
      entries.find((entry) => entry?.date || entry?.currentDate)?.date ||
      entries.find((entry) => entry?.date || entry?.currentDate)?.currentDate ||
      focusedDate ||
      getLastPlayedDateFromSchedule(scheduleByDate) ||
      fmt(seasonStart),
    seasonYear,
  });
  const feedSyncMs = cpuTradeNow() - feedStartedAt;
  let approxBytes = 0;
  try { approxBytes = JSON.stringify(entries).length; } catch {}
  recordCpuTradeTiming("feedSyncMs", feedSyncMs, { entryCount: entries.length });
  recordCpuTradeFeedWrite({
    entryCount: entries.length,
    completedEntryCount: entries.filter((entry) => entry?.type === "transaction").length,
    approxBytes,
    durationMs: feedSyncMs,
  });

  return savedFeed;
};

const showCpuTradeToast = (entry) => {
  if (!entry?.headline) return;

  const id = `${entry.id || "trade_toast"}_${Date.now()}`;
  const toast = {
    id,
    label: entry.label || "Trade Alert",
    headline: entry.headline,
    tag: entry.tag || "Completed",
  };

  setTradeToasts((prev) => [...prev.slice(-2), toast]);

  window.setTimeout(() => {
    setTradeToasts((prev) => prev.filter((row) => row.id !== id));
  }, 5200);
};

const computeAndSaveAllStarTeams = async ({ openModal = true } = {}) => {
  try {
    const expectedSeason = `${seasonYear}-${seasonYear + 1}`;
    let result = allStarData?.season === expectedSeason && allStarData?.all_star_version === ALL_STAR_LOGIC_VERSION ? allStarData : null;

    if (!result) {
      const saved = JSON.parse(localStorage.getItem("bm_all_stars_v1") || "null");
      if (saved?.season === expectedSeason && saved?.all_star_version === ALL_STAR_LOGIC_VERSION) result = saved;
    }

    if (!result) {
      const stats = loadPlayerStats();
      const payload = {
        season: expectedSeason,
        cutoff_date: ALL_STAR_DATE,
        min_games: 12,
        playerStats: stats,
        leagueData,
        scheduleByDate,
        resultsById,
        all_star_version: ALL_STAR_LOGIC_VERSION,
      };

      result = await computeAllStars(payload);
      result = { ...(result || {}), all_star_version: ALL_STAR_LOGIC_VERSION };
      localStorage.setItem("bm_all_stars_v1", JSON.stringify(result));
      appendPlayerMoodEvents(buildAllStarMoodEvents(result, ALL_STAR_DATE));
    }

    localStorage.setItem(ALL_STAR_HANDLED_KEY, "true");
    allStarHandledRef.current = true;
    setAllStarData(result);
    setAllStarPromptOpen(false);
    setAllStarOpen(Boolean(openModal));
    return result;
  } catch (err) {
    console.error("[AllStars] Failed to compute all stars:", err);
    return null;
  }
};

const openAllStarTeams = () => computeAndSaveAllStarTeams({ openModal: true });
async function openBoxScoreForGame(game) {
  if (!game?.id) return;

  try {
    const dbResult = await loadBoxScoreFromDB(game.id);
    const fallback = resultsById?.[game.id];
    const result = dbResult || fallback;

    setActionModal(null);
    setBoxModal({ game, result });
  } catch (e) {
    console.warn("[Calendar] failed loading box score from IndexedDB", e);
    const fallback = resultsById?.[game.id];
    setActionModal(null);
    setBoxModal({ game, result: fallback });
  }
}

function buildTeamsFromLeagueForSim(league) {
  return getAllTeamsFromLeague(league).map((t) => ({
    ...t,
    id: slugifyId(t.name),
  }));
}

function buildCpuTradeRosterTrace(leagueData, teamNames = []) {
  const requested = new Set((teamNames || []).filter(Boolean).map((name) => String(name)));
  return getAllTeamsFromLeague(leagueData)
    .filter((team) => !requested.size || requested.has(String(team?.name || team?.teamName || "")))
    .map((team) => {
      const evaluation = evaluateTeamSimulationRoster(team);
      return {
        teamName: evaluation.teamName,
        standardCount: evaluation.standardCount,
        twoWayCount: evaluation.twoWayCount,
        pendingRookieCount: evaluation.pendingRookieCount,
        simulationLegal: evaluation.ok,
        issueCodes: (evaluation.issues || []).map((issue) => issue.code),
      };
    });
}

async function repairCpuRostersBeforeSimulation({
  leagueData,
  selectedTeam,
  setLeagueData,
  currentDate = null,
}) {
  const repairRes = await repairCpuTeamsToMinRoster(
    leagueData,
    selectedTeam?.name || null,
    14,
    0
  );
  let repairedLeagueData = repairRes?.leagueData || leagueData;
  if (repairRes?.signings?.length) {
    repairedLeagueData = stampFreeAgentSigningRestrictions({
      beforeLeague: leagueData,
      afterLeague: repairedLeagueData,
      signedDate: currentDate,
      source: "cpu_auto_signing",
    });
  }
  const repairedTeams = buildTeamsFromLeagueForSim(repairedLeagueData);

  recordPreSimulationDiagnostics({
    leagueData: repairedLeagueData,
    selectedTeam,
    repairResult: repairRes,
    mode: "calendar_pre_simulation",
  });

  if (repairRes?.ok !== true) {
    const failures = [
      ...(repairRes?.failedTeams || []).map((row) => `${row.teamName} below minimum`),
      ...(repairRes?.overMaxTeams || []).map((row) => `${row.teamName} above maximum`),
      ...(repairRes?.overTwoWayTeams || []).map((row) => `${row.teamName} above two-way maximum`),
    ];
    throw new Error(
      `CPU roster repair failed before simulation: ${failures.join(", ") || "repair worker returned no successful result"}`
    );
  }

  const rosterMoves = [
    ...(repairRes?.signings || []),
    ...(repairRes?.droppedPlayers || []),
    ...(repairRes?.twoWayAssignments || []),
  ];

  console.log("[CPU Repair] pre-simulation roster audit passed", {
    signings: repairRes?.signings || [],
    droppedPlayers: repairRes?.droppedPlayers || [],
    twoWayAssignments: repairRes?.twoWayAssignments || [],
    minPlayers: repairRes?.minPlayers,
    maxPlayers: repairRes?.maxPlayers,
    twoWayMax: repairRes?.twoWayMax,
  });

  if (repairRes?.leagueData && typeof setLeagueData === "function") {
    setLeagueData(repairedLeagueData);
  }

  saveLeagueData(repairedLeagueData).catch((err) => {
    console.warn("[Calendar] Failed to save repaired leagueData to IndexedDB.", err);
  });

  if (rosterMoves.length) {
    const touchedTeams = Array.from(
      new Set(rosterMoves.map((row) => row?.teamName || row?.team).filter(Boolean))
    );

    for (const teamName of touchedTeams) {
      try {
        localStorage.removeItem(`gameplan_${teamName}`);
      } catch {}
    }
  }

  ensureGameplansForLeague(repairedLeagueData);

  return {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  };
}

function getCpuTradePoints(result, side) {
  if (!result) return NaN;
  const totals = result.totals || result.score || {};
  const winner = result.winner || {};
  const value = side === "home"
    ? totals.home ?? result.homeScore ?? winner.home
    : totals.away ?? result.awayScore ?? winner.away;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function buildCpuTradeRecordsByTeam(scheduleSnapshot = {}, resultsSnapshot = {}) {
  const map = {};

  const ensure = (teamName) => {
    if (!teamName) return null;
    if (!map[teamName]) {
      map[teamName] = {
        wins: 0,
        losses: 0,
        games: 0,
        w: 0,
        l: 0,
        gp: 0,
        pf: 0,
        pa: 0,
      };
    }
    return map[teamName];
  };

  for (const games of Object.values(scheduleSnapshot || {})) {
    for (const game of games || []) {
      if (!game?.id) continue;
      const result = resultsSnapshot?.[game.id];
      if (!game.played && !result) continue;

      const homePts = getCpuTradePoints(result, "home");
      const awayPts = getCpuTradePoints(result, "away");
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts) || homePts === awayPts) continue;

      const home = ensure(game.home);
      const away = ensure(game.away);
      if (!home || !away) continue;

      // Preserve the pre-existing generator-facing aliases exactly.
      home.games += 1;
      away.games += 1;
      if (homePts > awayPts) {
        home.wins += 1;
        away.losses += 1;
      } else {
        away.wins += 1;
        home.losses += 1;
      }

      // Exact validation historically read only totals/winner from ResultsV3.
      // Populate its fields from that same path so this speed optimization
      // cannot broaden or otherwise change which standings results it sees.
      const evaluationHomePts = Number(result?.totals?.home ?? result?.winner?.home);
      const evaluationAwayPts = Number(result?.totals?.away ?? result?.winner?.away);
      if (
        !Number.isFinite(evaluationHomePts) ||
        !Number.isFinite(evaluationAwayPts) ||
        evaluationHomePts === evaluationAwayPts
      ) {
        continue;
      }

      home.gp += 1;
      away.gp += 1;
      home.pf += evaluationHomePts;
      home.pa += evaluationAwayPts;
      away.pf += evaluationAwayPts;
      away.pa += evaluationHomePts;

      if (evaluationHomePts > evaluationAwayPts) {
        home.w += 1;
        away.l += 1;
      } else {
        away.w += 1;
        home.l += 1;
      }
    }
  }

  return map;
}

function daysBetweenDateStrings(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 999;
  return Math.ceil((to.getTime() - from.getTime()) / 86400000);
}

function makeCpuTradeGenerationLeagueData(leagueData = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  // The Python generator only needs live rosters, draft picks, standings context,
  // financials, and completed trade history. Sending the growing bank back into
  // the worker every pass makes the payload balloon and can stall long sims.
  const { cpuTradeBankState, ...leanLeagueData } = leagueData;
  return leanLeagueData;
}

function startCpuTradeBankGenerationJob({
  generationJobRef,
  leagueData,
  workerContext,
  generationContext,
}) {
  if (!generationJobRef || generationJobRef.current?.status === "pending") return false;

  const job = {
    id: `cpu_trade_bank_job_${Date.now()}_${workerContext?.generationNonce || 0}`,
    status: "pending",
    startedAt: Date.now(),
    workerContext,
    generationContext,
    response: null,
    error: null,
  };

  generationJobRef.current = job;

  const request = getCpuCpuTradeCandidates(
    makeCpuTradeGenerationLeagueData(leagueData),
    workerContext
  );
  job.requestId = request?.requestId || null;

  request
    .then((response) => {
      if (generationJobRef.current !== job) return;
      job.status = "fulfilled";
      job.response = response || { ok: true, candidates: [] };
      job.finishedAt = Date.now();
    })
    .catch((error) => {
      if (generationJobRef.current !== job) return;
      job.status = "rejected";
      job.error = error;
      job.finishedAt = Date.now();
    });

  return true;
}

function takeCompletedCpuTradeBankGenerationJob(generationJobRef) {
  const job = generationJobRef?.current;
  if (!job || job.status === "pending") return null;
  generationJobRef.current = null;
  return job;
}

function syncTradeDeskFeedHistoryWithTelemetry(leagueData, details = {}) {
  const startedAt = cpuTradeNow();
  const rows = syncTradeDeskFeedWithLeagueHistory(leagueData);
  const durationMs = cpuTradeNow() - startedAt;
  let approxBytes = 0;
  try {
    approxBytes = JSON.stringify(rows || []).length;
  } catch {}

  recordCpuTradeTiming("feedHistorySyncMs", durationMs, {
    ...details,
    rowCount: Array.isArray(rows) ? rows.length : 0,
  });
  recordCpuTradeFeedWrite({
    operation: "history_sync",
    ...details,
    entryCount: Array.isArray(rows) ? rows.length : 0,
    completedEntryCount: Array.isArray(rows)
      ? rows.filter((row) => row?.type === "transaction").length
      : 0,
    approxBytes,
    durationMs,
  });
  return rows;
}

function resolveCalendarControlledTeamName(selectedTeam, leagueData = {}) {
  const candidates = [
    selectedTeam,
    selectedTeam?.name,
    selectedTeam?.teamName,
    selectedTeam?.team,
    selectedTeam?.franchiseName,
    leagueData?.selectedTeam,
    leagueData?.userTeam,
    leagueData?.controlledTeam,
    leagueData?.selectedTeamName,
    leagueData?.userTeamName,
    leagueData?.controlledTeamName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    if (candidate && typeof candidate === "object") {
      const name =
        candidate?.name ||
        candidate?.teamName ||
        candidate?.team ||
        candidate?.franchiseName;

      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
    }
  }

  return "";
}


function shouldWriteCpuTradeDeskItems({ candidates = [], tradeDeskItems = [], currentDate, dayIndex, tradeDeadlineDate }) {
  if (!Array.isArray(tradeDeskItems) || !tradeDeskItems.length) return false;
  if (Array.isArray(candidates) && candidates.length) return true;

  const daysToDeadline = daysBetweenDateStrings(currentDate, tradeDeadlineDate);
  const idx = Number(dayIndex || 0);

  // Quiet-day rumor signals should not fill the feed every deadline-week date.
  if (daysToDeadline <= 7) return idx % 2 === 0;
  return idx % 12 === 0;
}

async function runCpuCpuTradePassForDate({
  activeLeagueData,
  currentDate,
  dayIndex,
  totalDates,
  scheduleSnapshot,
  resultsSnapshot,
  selectedTeam,
  setLeagueData,
  tradeDeadlineDate,
  firstPendingDate = null,
  generationJobRef,
  onTradeDeskEntries,
  onCpuTradeCompleted,
}) {
  if (!activeLeagueData || !currentDate || !tradeDeadlineDate) {
    return {
      leagueData: activeLeagueData,
      tradesMade: [],
      bankChanged: false,
      rosterChanged: false,
      skippedReason: "missing_context",
    };
  }

  if (shouldDisableCpuTradesForDiagnostics()) {
    if (generationJobRef?.current) {
      const staleRequestId = generationJobRef.current?.requestId || null;
      generationJobRef.current = null;
      cancelCpuTradeWorkerGeneration("diagnostics_no_cpu_trades", staleRequestId);
    }
    recordCpuTradeTrace("control", "cpu_trade_pass_disabled", {
      currentDate,
      dayIndex,
      tradeDeadlineDate,
    });
    return {
      leagueData: activeLeagueData,
      tradesMade: [],
      bankChanged: false,
      rosterChanged: false,
      skippedReason: "diagnostics_no_cpu_trades",
      bankSummary: buildCpuTradeBankSummary(activeLeagueData),
    };
  }

  // Critical performance/timing gate: once the deadline date is reached, do
  // not build season records, consume/revalidate bank candidates, or launch
  // Pyodide work. A pre-deadline background job may finish later; detaching it
  // here makes its completion harmless instead of letting it leak into March.
  if (!isCpuTradeWindowOpenDate(currentDate, tradeDeadlineDate)) {
    if (generationJobRef?.current) {
      const staleRequestId = generationJobRef.current?.requestId || null;
      generationJobRef.current = null;
      cancelCpuTradeWorkerGeneration("trade_deadline_locked", staleRequestId);
    }
    if (window.__debugCpuTrades) {
      console.log("[CPU Trade Bank] skipped after trade deadline", {
        currentDate,
        tradeDeadlineDate,
      });
    }
    return {
      leagueData: activeLeagueData,
      tradesMade: [],
      bankChanged: false,
      rosterChanged: false,
      skippedReason: "trade_deadline_locked",
      bankSummary: buildCpuTradeBankSummary(activeLeagueData),
    };
  }

  const cpuTradePassStartedAt = cpuTradeNow();
  const daysToDeadline = daysBetweenDateStrings(currentDate, tradeDeadlineDate);
  const recordsStartedAt = cpuTradeNow();
  const recordsByTeam = buildCpuTradeRecordsByTeam(scheduleSnapshot, resultsSnapshot);
  recordCpuTradeTiming("recordBuildMs", cpuTradeNow() - recordsStartedAt, {
    currentDate,
    scheduleDates: Object.keys(scheduleSnapshot || {}).length,
  });
  const baseContext = {
    seasonYear: getCalendarLeagueSeasonYear(activeLeagueData),
    currentDate,
    dayIndex,
    totalDates,
    deadlineDayIndex: Number(dayIndex || 0) + Math.max(0, daysToDeadline),
    tradeDeadlineDate,
    daysToDeadline,
    firstPendingDate,
    preseasonTradeWindow: Boolean(firstPendingDate && currentDate < firstPendingDate),
    userTeamName: resolveCalendarControlledTeamName(selectedTeam, activeLeagueData),
    recordsByTeam,
    inOffseason: false,
  };
  const testConfig = readCpuTradeBankTestConfig();

  let nextLeagueData = activeLeagueData;
  let bankChanged = false;
  let rosterChanged = false;
  const tradesMade = [];
  const passTraceEnabled = isCpuTradeDeepTraceEnabled();
  if (passTraceEnabled) {
    recordCpuTradeTrace("bank", "pass_started", {
      currentDate,
      dayIndex,
      daysToDeadline,
      bankSummary: buildCpuTradeBankSummary(activeLeagueData),
    });
  }

  try {
    const initialized = ensureCpuTradeBankState(nextLeagueData, baseContext, testConfig);
    if (initialized.leagueData) nextLeagueData = initialized.leagueData;
    bankChanged = bankChanged || initialized.changed;
    try {
      syncTradeDeskFeedHistoryWithTelemetry(nextLeagueData, {
        currentDate,
        reason: "pass_start_canonical_sync",
      });
    } catch {}
    ensureCpuTradeDiagnosticsSession({
      leagueData: nextLeagueData,
      bankState: initialized.state || nextLeagueData?.cpuTradeBankState,
      context: baseContext,
      selectedTeam,
    });

    const completedGenerationJob = takeCompletedCpuTradeBankGenerationJob(generationJobRef);
    const activeBankBeforeGenerationConsume = nextLeagueData?.cpuTradeBankState;
    const completedJobMatchesActiveBank =
      !completedGenerationJob ||
      (String(completedGenerationJob?.generationContext?.bankSeed || "") ===
        String(activeBankBeforeGenerationConsume?.seed || "") &&
        Number(completedGenerationJob?.generationContext?.seasonYear || 0) ===
          Number(activeBankBeforeGenerationConsume?.seasonYear || 0));

    if (completedGenerationJob && !completedJobMatchesActiveBank) {
      if (window.__debugCpuTrades) {
        console.log("[CPU Trade Bank] discarded stale background generation job", {
          jobSeasonYear: completedGenerationJob?.generationContext?.seasonYear,
          activeSeasonYear: activeBankBeforeGenerationConsume?.seasonYear,
          generatedDate: completedGenerationJob?.generationContext?.currentDate,
        });
      }
    } else if (completedGenerationJob?.status === "rejected") {
      console.warn("[CPU Trade Bank] background generation failed", completedGenerationJob.error);
    } else if (completedGenerationJob?.status === "fulfilled") {
      const generatedContext = {
        ...baseContext,
        generatedDate: completedGenerationJob?.generationContext?.currentDate || currentDate,
        generatedDayIndex:
          completedGenerationJob?.generationContext?.dayIndex ?? Number(dayIndex || 0),
      };
      const exactEvaluationLimit =
        completedGenerationJob?.generationContext?.exactEvaluations || 3;
      const added = await addGeneratedCpuTradeCandidates({
        leagueData: nextLeagueData,
        response: completedGenerationJob.response,
        context: generatedContext,
        testConfig,
        exactEvaluationLimit,
      });

      nextLeagueData = added.leagueData || nextLeagueData;
      bankChanged = bankChanged || added.changed;

      const responseCandidates = Array.isArray(completedGenerationJob.response?.candidates)
        ? completedGenerationJob.response.candidates
        : [];
      const tradeDeskItems = Array.isArray(completedGenerationJob.response?.tradeDeskItems)
        ? completedGenerationJob.response.tradeDeskItems
        : [];

      if (
        tradeDeskItems.length &&
        typeof onTradeDeskEntries === "function" &&
        shouldWriteCpuTradeDeskItems({
          candidates: added.accepted?.length ? added.accepted : responseCandidates,
          tradeDeskItems,
          currentDate: generatedContext.generatedDate,
          dayIndex: generatedContext.generatedDayIndex,
          tradeDeadlineDate,
        })
      ) {
        onTradeDeskEntries(tradeDeskItems.slice(0, added.accepted?.length ? 4 : 2));
      }

      if (window.__debugCpuTrades) {
        console.log("[CPU Trade Bank] generation consumed", {
          generatedDate: generatedContext.generatedDate,
          consumedDate: currentDate,
          proposed: responseCandidates.length,
          accepted: added.accepted?.length || 0,
          rejected: added.rejected?.length || 0,
          bankSize: added.state?.candidates?.length || 0,
          workerMs:
            completedGenerationJob.finishedAt && completedGenerationJob.startedAt
              ? completedGenerationJob.finishedAt - completedGenerationJob.startedAt
              : null,
          workerDebug: completedGenerationJob.response?.debug || null,
        });
      }
    }

    // Banked candidates are exact-validated at admission and again on live execution.
    // The bounded continuous market intentionally avoids repeated whole-bank revalidation.

    const runwayBeforeExecution = getCpuTradeBankRunwayStatus(
      nextLeagueData?.cpuTradeBankState,
      baseContext
    );
    let shouldForegroundGenerate = false;
    let foregroundReason = "";

    // Pre-opener dates can fly by very quickly because there are no games to await.
    // If we only launch background candidate jobs during that window, the sim can
    // reach opening night before the worker response is consumed, which is why the
    // trade log could start on Oct. 22 instead of showing true pre-season deals.
    // Do one bounded foreground fill only when the bank is thin and we are still
    // before the first pending game; this keeps sim speed safe during the actual
    // season while making the Oct. 1 -> opening-night market real.
    if (
      baseContext.preseasonTradeWindow &&
      generationJobRef?.current?.status !== "pending" &&
      Number(nextLeagueData?.cpuTradeBankState?.candidates?.length || 0) < 6
    ) {
      const preseasonPolicy = getCpuTradeBankGenerationPolicy(
        nextLeagueData?.cpuTradeBankState,
        baseContext,
        testConfig
      );
      const preseasonCompleted = Number(nextLeagueData?.cpuTradeBankState?.completedTrades || 0);
      const preseasonTarget = Math.min(5, Math.max(3, Math.ceil(Number(nextLeagueData?.cpuTradeBankState?.targetTrades || 24) * 0.18)));

      // Pre-opener empty calendar days complete too fast for background bank fill.
      // Force one tiny foreground fill until the preseason market has produced a
      // couple of deals, then fall back to normal background generation for speed.
      if (preseasonCompleted < preseasonTarget || preseasonPolicy?.shouldGenerate) {
        const forcedPreseasonPolicy = {
          ...preseasonPolicy,
          shouldGenerate: true,
          maxCandidates: Math.min(Math.max(Number(preseasonPolicy?.maxCandidates || 0), 42), 64),
          exactEvaluations: Math.min(Math.max(Number(preseasonPolicy?.exactEvaluations || 0), 18), 28),
          foregroundRecommended: true,
        };
        const workerContext = buildCpuTradeWorkerContext(
          nextLeagueData?.cpuTradeBankState,
          baseContext,
          forcedPreseasonPolicy
        );
        try {
          const response = await getCpuCpuTradeCandidates(
            makeCpuTradeGenerationLeagueData(nextLeagueData),
            workerContext
          );
          const added = await addGeneratedCpuTradeCandidates({
            leagueData: nextLeagueData,
            response: response || { ok: true, candidates: [] },
            context: {
              ...baseContext,
              generatedDate: currentDate,
              generatedDayIndex: Number(dayIndex || 0),
            },
            testConfig,
            exactEvaluationLimit: forcedPreseasonPolicy.exactEvaluations,
          });
          nextLeagueData = added.leagueData || nextLeagueData;
          bankChanged = bankChanged || added.changed;
          shouldForegroundGenerate = true;
          foregroundReason = "preseason_opening_market_fill";
        } catch (error) {
          foregroundReason = `preseason_generation_failed:${error?.message || String(error || "unknown")}`;
          console.warn("[CPU Trade Bank] preseason foreground generation failed", error);
        }
      }
    }

    let immediateMegaExecution = null;
    let immediateMegaLeagueBeforeExecution = null;

    const megaTradePolicy = getCpuMegaTradeGenerationPolicy(
      nextLeagueData?.cpuTradeBankState,
      baseContext,
      testConfig
    );

    // The one-per-season mega trade is now a prepared bonus event. Planning is
    // a tiny local recipe pass earlier in the season; execution happens with
    // timing variance before the deadline. Neither step uses the Python worker,
    // normal trade evaluator, exact-validation pool, or a deadline-day sweep.
    if (megaTradePolicy.shouldGenerate) {
      const megaContext = {
        ...baseContext,
        generatedDate: currentDate,
        generatedDayIndex: Number(dayIndex || 0),
        megaTradeMode: true,
        megaTradePlannerAction: megaTradePolicy.action,
      };

      try {
        if (megaTradePolicy.action === "plan") {
          const planned = prepareCpuMegaTradePlan({
            leagueData: nextLeagueData,
            context: megaContext,
            testConfig,
          });
          nextLeagueData = planned?.leagueData || nextLeagueData;
          bankChanged = bankChanged || Boolean(planned?.changed);
          foregroundReason = planned?.planned
            ? "mega_trade_plan_ready"
            : `mega_trade_plan_retry:${planned?.reason || "no_recipe"}`;
        } else if (megaTradePolicy.action === "execute" || megaTradePolicy.action === "plan_and_execute") {
          immediateMegaLeagueBeforeExecution = nextLeagueData;
          immediateMegaExecution = executePreparedCpuMegaTradePlan({
            leagueData: nextLeagueData,
            context: megaContext,
            testConfig,
            maxCandidateChecks: megaTradePolicy.maxCandidateChecks || 4,
          });
          nextLeagueData = immediateMegaExecution?.leagueData || nextLeagueData;
          bankChanged = bankChanged || Boolean(immediateMegaExecution?.changed);
          foregroundReason = immediateMegaExecution?.executed
            ? "prepared_mega_trade_executed"
            : `prepared_mega_trade_retry:${immediateMegaExecution?.reason || "no_valid_trade"}`;
          shouldForegroundGenerate = shouldForegroundGenerate || Boolean(immediateMegaExecution?.executed);
        }
      } catch (error) {
        foregroundReason = `mega_trade_planner_failed:${error?.message || String(error || "unknown")}`;
        console.warn("[CPU Trade Bank] prepared mega trade planner failed", error);
      }
    }

    let leagueDataBeforeCpuTradeExecution = immediateMegaExecution?.executed
      ? (immediateMegaLeagueBeforeExecution || nextLeagueData)
      : nextLeagueData;
    let execution = immediateMegaExecution?.executed ? immediateMegaExecution : null;

    if (!execution) {
      leagueDataBeforeCpuTradeExecution = nextLeagueData;
      execution = executeDueCpuTradeFromBank({
        leagueData: nextLeagueData,
        context: baseContext,
        testConfig,
        maxCandidateChecks: baseContext.preseasonTradeWindow ? 18 : (daysToDeadline <= 14 ? 10 : 8),
      });
    }

    if (execution?.leagueData) nextLeagueData = execution.leagueData;
    bankChanged = bankChanged || Boolean(execution?.changed);

    if (execution?.dryRun && window.__debugCpuTrades) {
      console.log("[CPU Trade Bank] dry-run candidate passed final revalidation", {
        currentDate,
        candidate: execution.dryRunCandidate,
        validation: execution.validation,
      });
    }

    if (execution?.executed && execution?.tradeRecord) {
      const directlyTradedTeamNames = [
        execution?.tradeRecord?.fromTeamName,
        execution?.tradeRecord?.toTeamName,
      ].filter(Boolean);
      const rosterCountsBeforeTrade = passTraceEnabled
        ? buildCpuTradeRosterTrace(leagueDataBeforeCpuTradeExecution, directlyTradedTeamNames)
        : null;
      const rosterCountsImmediatelyAfterTrade = passTraceEnabled
        ? buildCpuTradeRosterTrace(nextLeagueData, directlyTradedTeamNames)
        : null;
      if (passTraceEnabled) {
        recordCpuTradeTrace("repair", "post_trade_repair_started", {
          currentDate,
          dayIndex,
          tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
          teams: directlyTradedTeamNames,
          rosterCountsBeforeTrade,
          rosterCountsImmediatelyAfterTrade,
          repairQueueMs: null,
          repairWorkerComputeMs: null,
          timingScope: "main_thread_call_to_resolved_response",
        });
      }
      // A legal asymmetric trade may leave a CPU roster below the simulation
      // minimum. Repair it before announcing or persisting the completed trade,
      // so a failed repair cleanly rolls the whole pass back with no ghost feed.
      const rosterRepairStartedAt = cpuTradeNow();
      const postTradeRepair = await repairCpuTeamsToMinRoster(
        nextLeagueData,
        baseContext.userTeamName || null,
        14,
        Number(dayIndex || 0),
        { targetTeamNames: directlyTradedTeamNames }
      );
      const rosterRepairMs = cpuTradeNow() - rosterRepairStartedAt;
      recordCpuTradeTiming("rosterRepairMs", rosterRepairMs, {
        currentDate,
        tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
      });
      if (postTradeRepair?.leagueData) {
        nextLeagueData = postTradeRepair?.signings?.length
          ? stampFreeAgentSigningRestrictions({
              beforeLeague: nextLeagueData,
              afterLeague: postTradeRepair.leagueData,
              signedDate: currentDate,
              source: "cpu_auto_signing",
            })
          : postTradeRepair.leagueData;
      }

      recordCpuTradeRepairDiagnostics({
        currentDate,
        tradeRecord: execution.tradeRecord,
        repairResult: postTradeRepair,
      });

      if (postTradeRepair?.ok !== true) {
        if (passTraceEnabled) {
          recordCpuTradeTrace("repair", "post_trade_repair_failed", {
            currentDate,
            dayIndex,
            tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
            teams: directlyTradedTeamNames,
            rosterCountsBeforeTrade,
            rosterCountsImmediatelyAfterTrade,
            rosterCountsAfterRepair: buildCpuTradeRosterTrace(nextLeagueData, directlyTradedTeamNames),
            totalBlockingMs: rosterRepairMs,
            failedTeams: postTradeRepair?.failedTeams || [],
            overMaxTeams: postTradeRepair?.overMaxTeams || [],
            overTwoWayTeams: postTradeRepair?.overTwoWayTeams || [],
          });
        }
        throw new Error(
          `CPU roster repair failed after the trade: ${[
            ...(postTradeRepair?.failedTeams || []).map((row) => `${row.teamName} below minimum`),
            ...(postTradeRepair?.overMaxTeams || []).map((row) => `${row.teamName} above maximum`),
            ...(postTradeRepair?.overTwoWayTeams || []).map((row) => `${row.teamName} above two-way maximum`),
          ].join(", ") || "repair worker returned no successful result"}`
        );
      }

      const repairMoves = [
        ...(postTradeRepair?.signings || []),
        ...(postTradeRepair?.droppedPlayers || []),
        ...(postTradeRepair?.twoWayAssignments || []),
      ];
      const repairedTeamNames = Array.from(
        new Set(repairMoves.map((row) => row?.teamName || row?.team).filter(Boolean))
      );
      const directlyTradedTeams = [execution?.tradeRecord?.fromTeamName, execution?.tradeRecord?.toTeamName].filter(Boolean);
      const unrelatedTouchedTeams = repairedTeamNames.filter(
        (teamName) => !directlyTradedTeams.some((directTeam) => String(directTeam) === String(teamName))
      );
      recordCpuTradeRepair({
        currentDate,
        tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
        ok: postTradeRepair?.ok === true,
        durationMs: rosterRepairMs,
        moveCount: repairMoves.length,
        signings: postTradeRepair?.signings || [],
        droppedPlayers: postTradeRepair?.droppedPlayers || [],
        twoWayAssignments: postTradeRepair?.twoWayAssignments || [],
        touchedTeams: repairedTeamNames,
        directlyTradedTeams,
        unrelatedTouchedTeams,
        repairMode: postTradeRepair?.repairMode || "unknown",
        targetedFallbackUsed: Boolean(postTradeRepair?.targetedFallbackUsed),
        targetedFallbackReason: postTradeRepair?.targetedFallbackReason || null,
        targetedTeamNames: postTradeRepair?.targetedTeamNames || directlyTradedTeams,
        affectedTeamNames: postTradeRepair?.affectedTeamNames || repairedTeamNames,
      });
      if (passTraceEnabled) {
        recordCpuTradeTrace("repair", "post_trade_repair_completed", {
          currentDate,
          dayIndex,
          tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
          teams: directlyTradedTeams,
          rosterCountsBeforeTrade,
          rosterCountsImmediatelyAfterTrade,
          rosterCountsAfterRepair: buildCpuTradeRosterTrace(nextLeagueData, directlyTradedTeams),
          totalBlockingMs: rosterRepairMs,
          repairQueueMs: null,
          repairWorkerComputeMs: null,
          timingScope: "main_thread_call_to_resolved_response",
          moveCount: repairMoves.length,
          signings: postTradeRepair?.signings || [],
          droppedPlayers: postTradeRepair?.droppedPlayers || [],
          twoWayAssignments: postTradeRepair?.twoWayAssignments || [],
          touchedTeams: repairedTeamNames,
          unrelatedTouchedTeams,
        });
      }
      for (const teamName of repairedTeamNames) {
        try {
          localStorage.removeItem(`gameplan_${teamName}`);
        } catch {}
      }

      const gameplanRepairStartedAt = cpuTradeNow();
      try {
        ensureGameplansForLeague(nextLeagueData);
      } catch (error) {
        console.warn("[CPU Trade Bank] ensure gameplans failed after trade", error);
      } finally {
        recordCpuTradeTiming("gameplanRepairMs", cpuTradeNow() - gameplanRepairStartedAt, {
          currentDate,
          touchedTeams: repairedTeamNames,
        });
      }

      rosterChanged = true;
      tradesMade.push(execution.tradeRecord);
      recordCpuTradeCompleted({
        currentDate,
        dayIndex,
        tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
        fromTeamName: execution?.tradeRecord?.fromTeamName || "",
        toTeamName: execution?.tradeRecord?.toTeamName || "",
        buyerScore: Number(execution?.tradeRecord?.toTeamView?.score || 0),
        buyerThreshold: Number(execution?.tradeRecord?.toTeamView?.teamImpact?.threshold || 0),
        sellerScore: Number(execution?.tradeRecord?.fromTeamView?.score || 0),
        sellerThreshold: Number(execution?.tradeRecord?.fromTeamView?.teamImpact?.threshold || 0),
        repairRequired: Boolean(execution?.requiresRosterRepairBeforeSimulation),
      });

      const completedEntry = buildCompletedCpuTradeDeskEntry(execution.tradeRecord, currentDate);
      if (completedEntry && typeof onTradeDeskEntries === "function") {
        onTradeDeskEntries([completedEntry]);
      }
      if (completedEntry && typeof onCpuTradeCompleted === "function") {
        onCpuTradeCompleted(completedEntry, execution.tradeRecord);
      }
      try {
        syncTradeDeskFeedHistoryWithTelemetry(nextLeagueData, {
          currentDate,
          reason: "post_trade_canonical_sync",
          tradeId: execution?.tradeRecord?.id || execution?.tradeRecord?.bankId || "",
        });
      } catch {}

      if (window.__debugCpuTrades) console.log("[CPU Trade Bank] completed", execution.tradeRecord);
    } else if (
      execution?.reason === "no_valid_candidate" &&
      window.__debugCpuTrades
    ) {
      console.log("[CPU Trade Bank] execution slot deferred after stale entries", {
        currentDate,
        lastFailure: execution.lastFailure,
        bankSize: execution.state?.candidates?.length || 0,
      });
    }

    const activeState = nextLeagueData?.cpuTradeBankState;
    const generationPolicy = getCpuTradeBankGenerationPolicy(
      activeState,
      baseContext,
      testConfig
    );
    recordCpuTradeBankHealth({
      currentDate,
      dayIndex,
      daysToDeadline,
      bankSize: activeState?.candidates?.length || 0,
      completedTrades: activeState?.completedTrades || 0,
      minimumTrades: activeState?.minimumTrades || 0,
      targetTrades: activeState?.targetTrades || 0,
      remainingMinimum: Math.max(0, Number(activeState?.minimumTrades || 0) - Number(activeState?.completedTrades || 0)),
      remainingTarget: Math.max(0, Number(activeState?.targetTrades || 0) - Number(activeState?.completedTrades || 0)),
      maximumGenerationPasses: activeState?.maximumGenerationPasses || 0,
      maximumExactEvaluations: activeState?.maximumExactEvaluations || 0,
      planCursor: activeState?.planCursor || 0,
      nextPlannedDay: activeState?.executionPlanDays?.[activeState?.planCursor] ?? null,
      shouldGenerate: generationPolicy?.shouldGenerate || false,
      generationReason: generationPolicy?.reason || "",
      completionDeficit: generationPolicy?.completionDeficit || 0,
      reserveDeficit: generationPolicy?.reserveDeficit || 0,
      supplyUrgent: generationPolicy?.supplyUrgent || false,
      supplySatisfied: generationPolicy?.supplySatisfied || false,
      foregroundTriggered: false,
      foregroundReason,
      burstDepth: 0,
    });

    if (
      generationPolicy.shouldGenerate &&
      generationJobRef?.current?.status !== "pending"
    ) {
      const workerContext = buildCpuTradeWorkerContext(
        activeState,
        baseContext,
        generationPolicy
      );
      startCpuTradeBankGenerationJob({
        generationJobRef,
        leagueData: nextLeagueData,
        workerContext,
        generationContext: {
          currentDate,
          dayIndex,
          seasonYear: activeState?.seasonYear,
          bankSeed: activeState?.seed,
          exactEvaluations: generationPolicy.exactEvaluations,
        },
      });

      if (window.__debugCpuTrades) {
        console.log("[CPU Trade Bank] background generation launched", {
          currentDate,
          dayIndex,
          maxCandidates: generationPolicy.maxCandidates,
          exactEvaluations: generationPolicy.exactEvaluations,
          cadence: generationPolicy.cadence,
          desiredReserve: generationPolicy.desiredReserve,
          bankSize: activeState?.candidates?.length || 0,
        });
      }
    }

    if (bankChanged || rosterChanged) {
      try {
        syncTradeDeskFeedHistoryWithTelemetry(nextLeagueData, {
          currentDate,
          reason: rosterChanged ? "pre_save_trade_sync" : "pre_save_bank_sync",
        });
      } catch {}
      if (typeof setLeagueData === "function") setLeagueData(nextLeagueData);
      const storageReason = rosterChanged ? "trade_or_roster_change" : "bank_state_only";
      // CPU trade passes can finish much faster than a full IndexedDB league
      // write. Queue the newest snapshot and let one serialized writer persist
      // it; intermediate bank-only snapshots are safely covered by the latest
      // state instead of opening dozens of overlapping transactions.
      enqueueCpuTradeLeagueSave({
        leagueData: nextLeagueData,
        currentDate,
        reason: storageReason,
      }).catch((error) => {
        console.warn("[CPU Trade Bank] failed to save queued bank/trade state", error);
      });

      try {
        window.__leagueData = nextLeagueData;
        window.leagueData = nextLeagueData;
        window.__basketballManagerLeagueData = nextLeagueData;
      } catch {}
    }

    const totalCpuTradeProcessingMs = cpuTradeNow() - cpuTradePassStartedAt;
    recordCpuTradeTiming("totalCpuTradeProcessingMs", totalCpuTradeProcessingMs, {
      currentDate,
      tradesCompleted: tradesMade.length,
    });
    const completedBankSummary = buildCpuTradeBankSummary(nextLeagueData);
    recordCpuTradePass({
      currentDate,
      dayIndex,
      durationMs: totalCpuTradeProcessingMs,
      tradesCompleted: tradesMade.length,
      bankChanged,
      rosterChanged,
      burstDepth: 0,
      error: null,
      bankSummary: completedBankSummary,
    });
    if (passTraceEnabled) {
      recordCpuTradeTrace("bank", "pass_completed", {
        currentDate,
        dayIndex,
        durationMs: totalCpuTradeProcessingMs,
        tradesCompleted: tradesMade.length,
        bankChanged,
        rosterChanged,
        burstDepth: 0,
        bankSummary: completedBankSummary,
      });
    }
    return {
      leagueData: nextLeagueData,
      tradesMade,
      bankChanged,
      rosterChanged,
      bankSummary: buildCpuTradeBankSummary(nextLeagueData),
    };
  } catch (error) {
    const totalCpuTradeProcessingMs = cpuTradeNow() - cpuTradePassStartedAt;
    recordCpuTradeTiming("totalCpuTradeProcessingMs", totalCpuTradeProcessingMs, {
      currentDate,
      failed: true,
    });
    recordCpuTradePass({
      currentDate,
      dayIndex,
      durationMs: totalCpuTradeProcessingMs,
      tradesCompleted: 0,
      bankChanged: false,
      rosterChanged: false,
      burstDepth: 0,
      error: error?.message || String(error || ""),
    });
    if (passTraceEnabled) {
      recordCpuTradeTrace("bank", "pass_failed", {
        currentDate,
        dayIndex,
        durationMs: totalCpuTradeProcessingMs,
        error: error?.message || String(error || ""),
      });
    }
    console.warn("[CPU Trade Bank] pass failed", error);
    return {
      leagueData: activeLeagueData,
      tradesMade: [],
      bankChanged: false,
      rosterChanged: false,
      error,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*                           SIMULATION HANDLERS                               */
/* -------------------------------------------------------------------------- */
const handleSimOnlyGame = async (dateStr, game) => {
  if (shouldPauseForContractExtensionDeadline(dateStr)) {
    saveSimulationCursorDate(dateStr);
    openContractExtensionDeadlinePrompt(dateStr);
    return;
  }

  if (shouldPauseForTradeDeadline(dateStr)) {
    saveSimulationCursorDate(dateStr);
    openTradeDeadlinePrompt();
    return;
  }

  const canonicalExisting = loadOneResultV3(game?.id) || resultsById?.[game?.id] || null;
  if (hasUsableStoredResult(canonicalExisting)) {
    setResultsById((prev) => ({ ...prev, [game.id]: canonicalExisting }));
    setScheduleByDate((prev) => ({
      ...prev,
      [dateStr]: (prev?.[dateStr] || []).map((row) =>
        row?.id === game.id ? { ...row, played: true } : row
      ),
    }));
    setActionModal(null);
    setBoxModal({ game: { ...game, played: true }, result: canonicalExisting });
    return;
  }

  const {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  } = await repairCpuRostersBeforeSimulation({
    leagueData,
    selectedTeam,
    setLeagueData,
    currentDate: dateStr,
  });

  const userTeamLive = repairedTeams.find((t) => t.name === selectedTeam?.name);
  const userRosterMessage = getUserRosterSimBlockMessage(userTeamLive || selectedTeam);

  if (userRosterMessage) {
    openSimError(userRosterMessage, "Roster issue");
    return;
  }

  const simBlockMessage = getSimulationBlockMessageForGame(game, repairedTeams);
  if (simBlockMessage) {
    openSimError(simBlockMessage, "Simulation blocked");
    return;
  }

  if (repairRes?.signings?.length || repairRes?.droppedPlayers?.length || repairRes?.twoWayAssignments?.length) {
    console.log("[CPU Roster Repair] auto-signings before single game:", repairRes?.signings || []);
    console.log("[CPU Roster Repair] auto-drops before single game:", repairRes?.droppedPlayers || []);
    console.log("[CPU Roster Repair] auto-two-way assignments before single game:", repairRes?.twoWayAssignments || []);
  }

  let activeLeagueData = repairedLeagueData;
  let activeTeams = repairedTeams;
  const recovery = recoverPlayersForDate(activeLeagueData, dateStr);
  if (recovery.touchedTeamNames.length) {
    const refreshed = refreshInjuryTouchedTeams(activeLeagueData, recovery.touchedTeamNames);
    if (refreshed) {
      activeTeams = refreshed.teams;
    }
  }
  if (shouldPauseForUserInjuryEvents(recovery.events, null)) return;

  const upd = { ...scheduleByDate };
  const newResults = { ...resultsById };

  const simRuntime = buildSimulationRuntime(activeLeagueData, activeTeams);
  let full;
  try {
    full = await runGameWithRetries(game, activeLeagueData, activeTeams, 3, simRuntime, dateStr);
  } catch (err) {
    openSimError(
      err?.message || "This team doesn't have enough players.",
      "Simulation blocked"
    );
    return;
  }

  if (!full) {
    console.error("[SimOnly] Could not get a valid result for game", game.id);
    return;
  }

  const result = slimResult(full);
  const homeRoles = simRuntime.roleByTeam.get(game.home) || {};
  const awayRoles = simRuntime.roleByTeam.get(game.away) || {};
  const homeOrder = simRuntime.orderByTeam.get(game.home) || [];
  const awayOrder = simRuntime.orderByTeam.get(game.away) || [];
  annotateSlimWithRoles(result, homeRoles, awayRoles, homeOrder, awayOrder);

  upd[dateStr] = upd[dateStr].map((g) =>
    g.id === game.id ? { ...g, played: true } : g
  );

  const canonicalResult = await saveOneResultV3(game.id, result, game, seasonYear);
  if (!sameLockedScore(canonicalResult, result)) {
    setResultsById((prev) => ({ ...prev, [game.id]: canonicalResult }));
    setScheduleByDate((prev) => ({
      ...prev,
      [dateStr]: (prev?.[dateStr] || []).map((row) =>
        row?.id === game.id ? { ...row, played: true } : row
      ),
    }));
    setActionModal(null);
    setBoxModal({ game: { ...game, played: true }, result: canonicalResult });
    return;
  }

  newResults[game.id] = canonicalResult || result;
  let playerStats = loadPlayerStats();
  let clutchStats = loadClutchStats(seasonYear);
  const playerStatsBeforeGame = playerStats;
  playerStats = applyGameToPlayerStats(playerStats, result, game);
  clutchStats = applyGameToClutchStats(clutchStats, result, game, seasonYear);
  appendPlayerMoodEvents(buildGamePerformanceMoodEvents(result, game, dateStr, {
    teams: activeTeams,
    scheduleByDate: upd,
    resultsById: newResults,
    playerStatsBefore: playerStatsBeforeGame,
    seasonYear,
  }));

  const injuryResult = processGameInjuries({
    leagueData: activeLeagueData,
    game,
    result: canonicalResult || result,
    currentDate: dateStr,
  });
  if (injuryResult.touchedTeamNames.length) {
    refreshInjuryTouchedTeams(activeLeagueData, injuryResult.touchedTeamNames);
  }

  savePlayerStats(playerStats);
  saveClutchStats(clutchStats);

  saveSchedule(upd);
  refreshTradeDeadlineLockFromSchedule(upd);
  await flushPendingResultWrites();
  setResultsById((prev) => ({ ...prev, [game.id]: canonicalResult || result }));
  saveCalendarCursor(dateStr, monthKey(new Date(dateStr)));
  setFocusedDate(dateStr);
  setMonth(monthKey(new Date(dateStr)));

  setActionModal(null);
  if (!shouldPauseForUserInjuryEvents(injuryResult.events, null)) {
    setBoxModal({ game, result: canonicalResult || result });
  }
};

const handleSimToDate = async (dateStr, { resume = false } = {}) => {
  if (!acquireSimRunLock("SimToDate")) return;

  const simulationCursorAtStart = readSimulationCursorDate();
  const firstPendingForTarget = findFirstPendingSimulationDate(scheduleByDate, resultsById);
  if (dateStr < simulationCursorAtStart) {
    releaseSimRunLock();
    setActionModal(null);
    openSimError(
      `Cannot simulate backwards to ${dateStr}. The next unsimulated calendar date is ${simulationCursorAtStart}.`,
      "Simulation already past this date"
    );
    return;
  }
  if (!firstPendingForTarget && dateStr >= simulationCursorAtStart) {
    releaseSimRunLock();
    setActionModal(null);
    openSimError("The regular season has already been fully simulated.", "Season complete");
    return;
  }

  // start from whatever is already in storage
  let playerStats = loadPlayerStats();
  let clutchStats = loadClutchStats(seasonYear);

    const {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  } = await repairCpuRostersBeforeSimulation({
    leagueData,
    selectedTeam,
    setLeagueData,
    currentDate: firstPendingForTarget || dateStr,
  });

  const userTeamLive = repairedTeams.find((t) => t.name === selectedTeam?.name);
  const userRosterMessage = getUserRosterSimBlockMessage(userTeamLive || selectedTeam);

if (userRosterMessage) {
  releaseSimRunLock();
  openSimError(userRosterMessage, "Roster issue");
  return;
}

const simBlockMessage = getSimulationBlockMessageThroughDate(
  scheduleByDate,
  repairedTeams,
  dateStr
);
if (simBlockMessage) {
  releaseSimRunLock();
  openSimError(simBlockMessage, "Simulation blocked");
  return;
}

setActionModal(null);
setBoxModal(null);

  const pendingIntentBeforeRun = readPendingSimulationIntent();
  persistPendingSimIntent({
    mode: "to_date",
    targetDate: dateStr,
    seasonYear,
    pausedReason: null,
    resumed: Boolean(resume),
  });

  // ✅ reset stop state at the start of THIS run
  stopRef.current = false;
  setStopRequested(false);

  setSimLock(true);
  console.log("▶ SimToDate ENTER:", dateStr);

  let upd = structuredClone(scheduleByDate);
  let newResults = structuredClone(resultsById);
  try {
    newResults = reconcileCompletedGamesWithCanonicalStorage(upd, newResults);
  } catch (error) {
    releaseSimRunLock();
    clearPendingSimIntent();
    openSimError(error?.message || "The schedule contains conflicting completed games.", "Season integrity issue");
    return;
  }
  const lockedGamesAtStart = snapshotLockedRegularSeasonGames(upd, newResults);
  const firstPendingTradeDate = findFirstPendingSimulationDate(upd, newResults);
  const runStartCursorDate = readSimulationCursorDate();
  const allowPreseasonCpuTrades = Boolean(firstPendingTradeDate && runStartCursorDate < firstPendingTradeDate);
  const simulationPerf = {
    mode: "to_date",
    targetDate: dateStr,
    runId: createSimulationOrderRunId("to_date", dateStr),
    resumed: Boolean(resume),
    pendingIntentBeforeRun,
    startedAt: Date.now(),
    firstPendingDate: firstPendingTradeDate,
    runStartCursorDate,
    datesVisited: 0,
    historicalDatesSkipped: 0,
    deadlineDatesSkipped: 0,
    cpuTradePasses: 0,
    cpuTradeMs: 0,
    cpuTradesCompleted: 0,
    gamesSimmed: 0,
    gameOrderDateInversions: 0,
    gameExecutionSequence: 0,
    gameExecutionOrder: [],
    checkpointEvents: [],
  };

  const sorted = Object.keys(upd).sort((a, b) => new Date(a) - new Date(b));
  const sortedIndexByDate = new Map(sorted.map((date, index) => [date, index]));
  let lastCpuTradePassDayIndex = null;

  let activeLeagueData = repairedLeagueData;
  let activeTeams = repairedTeams;
  let simRuntime = buildSimulationRuntime(activeLeagueData, activeTeams);
  let shouldGoToAwards = false;
  let pausedAtCheckpoint = false;
  let lastDateProcessed = null;
  const simulationTraceEnabled = isCpuTradeDeepTraceEnabled();
  const stopCpuTradeMainThreadMonitor = startCpuTradeMainThreadMonitor();
  if (simulationTraceEnabled) {
    recordCpuTradeTrace("simulation", "sim_to_date_started", {
      targetDate: dateStr,
      firstPendingDate: firstPendingTradeDate,
      runStartCursorDate,
      resumed: Boolean(resume),
    });
  }

  try {
for (const d of sorted) {
  // ✅ allow stop between dates
  if (stopRef.current) break;

  if (d > dateStr) break;
  if (d < runStartCursorDate) {
    simulationPerf.historicalDatesSkipped += 1;
    continue;
  }
  lastDateProcessed = d;
  simulationPerf.datesVisited += 1;

  const recovery = recoverPlayersForDate(activeLeagueData, d);
  if (recovery.touchedTeamNames.length) {
    const refreshed = refreshInjuryTouchedTeams(activeLeagueData, recovery.touchedTeamNames);
    if (refreshed) {
      activeTeams = refreshed.teams;
      simRuntime = refreshed.runtime;
    }
  }
  if (shouldPauseForUserInjuryEvents(recovery.events, {
    mode: "to_date",
    targetDate: dateStr,
    seasonYear,
  })) {
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    await saveResults(newResults);
    await flushPendingResultWrites();
    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));
    pausedAtCheckpoint = true;
    saveSimulationCursorDate(d);
    return;
  }

  if (shouldPauseForContractExtensionDeadline(d)) {
    recordSimulationCheckpointEvent(simulationPerf, {
      type: "pause",
      reason: "contract_extension_deadline",
      scheduledDate: d,
      targetDate: dateStr,
    });
    assertLockedRegularSeasonGamesUnchanged(
      lockedGamesAtStart,
      upd,
      newResults,
      "contract-extension deadline checkpoint"
    );
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    await saveResults(newResults);
    await flushPendingResultWrites();

    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));
    pausedAtCheckpoint = true;
    persistPendingSimIntent({
      mode: "to_date",
      targetDate: dateStr,
      seasonYear,
      pausedReason: "contract_extension_deadline",
    });
    openContractExtensionDeadlinePrompt(d);
    return;
  }

  if (shouldPauseForTradeDeadline(d)) {
    recordSimulationCheckpointEvent(simulationPerf, {
      type: "pause",
      reason: "trade_deadline",
      scheduledDate: d,
      targetDate: dateStr,
    });
    assertLockedRegularSeasonGamesUnchanged(
      lockedGamesAtStart,
      upd,
      newResults,
      "trade-deadline checkpoint"
    );
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    await saveResults(newResults);
    await flushPendingResultWrites();
    refreshTradeDeadlineLockFromSchedule(upd);

    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));
    pausedAtCheckpoint = true;
    persistPendingSimIntent({
      mode: "to_date",
      targetDate: dateStr,
      seasonYear,
      pausedReason: "trade_deadline",
    });
    openTradeDeadlinePrompt();
    return;
  }

  if (d === ALL_STAR_DATE && !allStarHandledRef.current) {
    recordSimulationCheckpointEvent(simulationPerf, {
      type: "pause",
      reason: "all_star",
      scheduledDate: d,
      targetDate: dateStr,
    });
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    await saveResults(newResults);
    await flushPendingResultWrites();

    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));
    pausedAtCheckpoint = true;
    persistPendingSimIntent({
      mode: "to_date",
      targetDate: dateStr,
      seasonYear,
      pausedReason: "all_star",
    });
    saveSimulationCursorDate(d);
    setAllStarPromptOpen(true);
    return;
  }

  const cpuTradeDecision = getCpuTradeSimulationDateDecision({
    currentDate: d,
    firstPendingDate: firstPendingTradeDate,
    tradeDeadlineDate: TRADE_DEADLINE_DATE,
    preseasonTradeStartDate: fmt(seasonStart),
    allowPreseasonTrades: allowPreseasonCpuTrades,
  });
  const cpuTradeDayIndex = sortedIndexByDate.get(d) ?? 0;
  const cpuTradePacing = getCpuTradeCalendarPacingDecision({
    bankState: activeLeagueData?.cpuTradeBankState,
    currentDate: d,
    dayIndex: cpuTradeDayIndex,
    tradeDeadlineDate: TRADE_DEADLINE_DATE,
    lastCpuTradePassDayIndex,
    basicDecision: cpuTradeDecision,
  });
  if (cpuTradeDecision.shouldRun && cpuTradePacing.shouldRun) {
    const cpuTradeStartedAt = Date.now();
    const cpuTradePass = await runCpuCpuTradePassForDate({
      activeLeagueData,
      currentDate: d,
      dayIndex: cpuTradeDayIndex,
      totalDates: sorted.length,
      scheduleSnapshot: upd,
      resultsSnapshot: newResults,
      selectedTeam,
      setLeagueData,
      tradeDeadlineDate: TRADE_DEADLINE_DATE,
      firstPendingDate: firstPendingTradeDate,
      generationJobRef: cpuTradeGenerationJobRef,
      onTradeDeskEntries: handleTradeDeskEntries,
      onCpuTradeCompleted: showCpuTradeToast,
    });
    lastCpuTradePassDayIndex = cpuTradeDayIndex;
    simulationPerf.cpuTradePasses += 1;
    simulationPerf.cpuTradeMs += Date.now() - cpuTradeStartedAt;
    simulationPerf.cpuTradesCompleted += cpuTradePass?.tradesMade?.length || 0;
    bumpPerfCounter("cpuTrade.calendarPasses");
    if (cpuTradePass.leagueData !== activeLeagueData) {
      activeLeagueData = cpuTradePass.leagueData;
    }
    if (cpuTradePass.rosterChanged) {
      activeTeams = buildTeamsFromLeagueForSim(activeLeagueData);
      simRuntime = buildSimulationRuntime(activeLeagueData, activeTeams);
    }
  } else if (cpuTradeDecision.shouldRun) {
    bumpPerfCounter(`cpuTrade.calendarSkip.${cpuTradePacing.reason || "unknown"}`);
  } else if (cpuTradeDecision.reason === "historical_date_already_simulated") {
    simulationPerf.historicalDatesSkipped += 1;
  } else if (cpuTradeDecision.reason === "trade_deadline_locked") {
    simulationPerf.deadlineDatesSkipped += 1;
  }

  // Preserve checkpoint/trade handling above, but never walk every completed game
  // again on a resumed run. Preseason dates can run cheap CPU trade checks only.
  if (!firstPendingTradeDate || d < firstPendingTradeDate) {
    simulationPerf.historicalDatesSkipped += 1;
    continue;
  }

  const dayGames = upd[d];
  if (!Array.isArray(dayGames)) continue;
  const dayMoodEvents = [];
  const dayResultUpdates = {};
  let dayChanged = false;

      for (let i = 0; i < dayGames.length; i++) {
        // ✅ allow stop between games
        if (stopRef.current) break;

        const g = dayGames[i];
        if (!g) continue;

        const storedExisting = loadOneResultV3(g.id);
        const canonicalExisting = hasUsableStoredResult(storedExisting)
          ? storedExisting
          : hasUsableStoredResult(newResults?.[g.id])
            ? newResults[g.id]
            : null;

        if (canonicalExisting) {
          newResults[g.id] = canonicalExisting;
          if (!g.played) dayGames[i] = { ...g, played: true };
          continue;
        }

        if (g.played) dayGames[i] = { ...g, played: false };

        const gameOrderEvent = startSimulationGameOrderEvent(simulationPerf, {
          scheduledDate: d,
          gameIndex: i,
          game: g,
        });

        try {
          const full = await runGameWithRetries(g, activeLeagueData, activeTeams, 3, simRuntime, d);

          // ✅ if user clicked stop while this game was running, bail after it finishes
          if (stopRef.current) {
            finishSimulationGameOrderEvent(gameOrderEvent, "stopped_after_worker");
            break;
          }

          // still failed → skip, leave unplayed
          if (!full) {
            finishSimulationGameOrderEvent(gameOrderEvent, "no_result");
            continue;
          }

          const slim = slimResult(full);

const homeRoles = simRuntime.roleByTeam.get(g.home) || {};
const awayRoles = simRuntime.roleByTeam.get(g.away) || {};
          annotateSlimWithRoles(
            slim,
            homeRoles,
            awayRoles,
            simRuntime.orderByTeam.get(g.home) || [],
            simRuntime.orderByTeam.get(g.away) || []
          );

          const canonicalResult = await saveOneResultV3(
            g.id,
            slim,
            g,
            seasonYear,
            { deferIndexWrite: true }
          );

          if (!sameLockedScore(canonicalResult, slim)) {
            newResults[g.id] = canonicalResult;
            dayResultUpdates[g.id] = canonicalResult;
            dayGames[i] = { ...g, played: true };
            finishSimulationGameOrderEvent(gameOrderEvent, "canonical_restored");
            console.error("[SimToDate] restored canonical locked result instead of applying duplicate simulation", g.id);
            continue;
          }

          newResults[g.id] = canonicalResult || slim;
          dayResultUpdates[g.id] = canonicalResult || slim;

          dayGames[i] = { ...g, played: true };
          simulationPerf.gamesSimmed += 1;
          finishSimulationGameOrderEvent(gameOrderEvent, "completed");

          // 🔥 update player stats
          const playerStatsBeforeGame = playerStats;
          playerStats = applyGameToPlayerStats(playerStats, slim, g);
          clutchStats = applyGameToClutchStats(clutchStats, slim, g, seasonYear);
          dayMoodEvents.push(...buildGamePerformanceMoodEvents(slim, g, d, {
            teams: activeTeams,
            scheduleByDate: upd,
            resultsById: newResults,
            playerStatsBefore: playerStatsBeforeGame,
            seasonYear,
          }));

          const injuryResult = processGameInjuries({
            leagueData: activeLeagueData,
            game: g,
            result: canonicalResult || slim,
            currentDate: d,
          });
          if (injuryResult.touchedTeamNames.length) {
            const refreshed = refreshInjuryTouchedTeams(activeLeagueData, injuryResult.touchedTeamNames);
            if (refreshed) {
              activeTeams = refreshed.teams;
              simRuntime = refreshed.runtime;
            }
          }

          dayChanged = true;

          if (shouldPauseForUserInjuryEvents(injuryResult.events, {
            mode: "to_date",
            targetDate: dateStr,
            seasonYear,
          })) {
            upd[d] = dayGames;
            if (dayMoodEvents.length) appendPlayerMoodEvents(dayMoodEvents);
            savePlayerStats(playerStats);
            saveClutchStats(clutchStats);
            cleanupGhostGames(upd, newResults);
            saveSchedule(upd);
            await saveResults(newResults);
            await flushPendingResultWrites();
            setScheduleByDate(structuredClone(upd));
            setResultsById(structuredClone(newResults));
            pausedAtCheckpoint = true;
            saveSimulationCursorDate(d);
            return;
          }
        } catch (err) {
          finishSimulationGameOrderEvent(gameOrderEvent, "error", {
            message: String(err?.message || err || "unknown error"),
          });
          console.error("[SimToDate] ERROR for game", g.id, err);
          // keep unplayed on error
        }

      }

      upd[d] = dayGames;
      if (dayMoodEvents.length) appendPlayerMoodEvents(dayMoodEvents);
      if (dayChanged) {
        setScheduleByDate((prev) => ({ ...prev, [d]: dayGames.slice() }));
        setResultsById((prev) => ({ ...prev, ...dayResultUpdates }));
        flushResultIndexCache();
      }
      await yieldToBrowser();
    }

    // final saves (even if stopped, we save progress)
    const lastPlayedDate =
      getLastPlayedDateFromSchedule(upd) || dateStr;

    if (lastPlayedDate) {
      saveCalendarCursor(lastPlayedDate, monthKey(new Date(lastPlayedDate)));
      setFocusedDate(lastPlayedDate);
      setMonth(monthKey(new Date(lastPlayedDate)));
    }
    if (!pausedAtCheckpoint) {
      const cursorBase = stopRef.current
        ? (findFirstPendingSimulationDate(upd, newResults) || lastDateProcessed || dateStr)
        : dateStr;
      saveSimulationCursorDate(stopRef.current ? cursorBase : getNextCalendarDateString(cursorBase));
    }

    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    assertLockedRegularSeasonGamesUnchanged(
      lockedGamesAtStart,
      upd,
      newResults,
      "simulation completion"
    );
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    await saveResults(newResults);
    await flushPendingResultWrites();

    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));

    if (!stopRef.current && isRegularSeasonComplete(upd, newResults)) {
      const awards = await computeAndSaveCalendarAwards({
        playerStats,
        schedule: upd,
        results: newResults,
        activeTeams: activeTeams,
        gamesSimmed: countCompletedRegularSeasonGames(upd, newResults),
      });
      shouldGoToAwards = Boolean(awards?.mvp);
      if (!shouldGoToAwards) {
        openSimError(
          "The regular season finished, but awards could not be generated because the final player-stat archive was incomplete. The game stayed on Calendar so no empty awards page is saved.",
          "Awards generation issue"
        );
      }
    }
  } finally {
    stopCpuTradeMainThreadMonitor();
    if (simulationTraceEnabled) {
      recordCpuTradeTrace("simulation", "sim_to_date_finishing", {
        targetDate: dateStr,
        elapsedMs: Date.now() - simulationPerf.startedAt,
        gamesSimmed: simulationPerf.gamesSimmed,
        cpuTradePasses: simulationPerf.cpuTradePasses,
        cpuTradesCompleted: simulationPerf.cpuTradesCompleted,
        stopped: Boolean(stopRef.current),
        pausedAtCheckpoint,
      });
    }
    try {
      await flushCpuTradeLeagueSaves();
    } catch (error) {
      console.warn("[CPU Trade Bank] failed to flush queued league saves", error);
    }
    recordSimulationPerformanceDiagnostics({
      ...simulationPerf,
      elapsedMs: Date.now() - simulationPerf.startedAt,
      stopped: Boolean(stopRef.current),
      pausedAtCheckpoint,
    });
    setActionModal(null);
    releaseSimRunLock();
    console.log("◀ SimToDate EXIT:", dateStr);

    if (!pausedAtCheckpoint) {
      clearPendingSimIntent();
    }

    if (shouldGoToAwards) {
      navigate("/awards");
    }
  }
};




function sanitizeTeam(team) {
  if (!team) return null;

  const clean = structuredClone(team);

  // remove React garbage
  delete clean._reactInternals;
  for (const key of Object.keys(clean)) {
    if (key.startsWith("__react")) delete clean[key];
  }

  // remove anything unserializable
  for (const p of clean.players || []) {
    delete p._reactInternals;
    for (const key of Object.keys(p)) {
      if (key.startsWith("__react")) delete p[key];
    }
  }

  // load minutes
clean.minutes = readFlatMinutesFromGameplan(team.name);

  // defaults for missing attrs
  clean.strategy = clean.strategy || {};
  clean.team_ratings =
    clean.team_ratings && typeof clean.team_ratings === "object"
      ? clean.team_ratings
      : { offense: 50, defense: 50 };

  return clean;
}

async function simulateBatch(games) {
  // games = [ { id, home, away }, ... ] (clean objects)
  const results = [];

  // Run each game through queueSim + simulateOneGame
  for (const g of games) {
    const full = await queueSim(() =>
      simulateOneGame({
        homeTeam: g.home,
        awayTeam: g.away
      })
    );

    results.push(full);
  }

  return results;
}

const handleSimSeason = async ({ resume = false } = {}) => {
  if (!acquireSimRunLock("FullSeason")) return;
    const {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  } = await repairCpuRostersBeforeSimulation({
    leagueData,
    selectedTeam,
    setLeagueData,
    currentDate: findFirstPendingSimulationDate(scheduleByDate, resultsById),
  });

  const userTeamLive = repairedTeams.find((t) => t.name === selectedTeam?.name);
  const userRosterMessage = getUserRosterSimBlockMessage(userTeamLive || selectedTeam);
if (userRosterMessage) {
  releaseSimRunLock();
  openSimError(userRosterMessage, "Roster issue");
  return;
}

const simBlockMessage = getSimulationBlockMessageThroughDate(
  scheduleByDate,
  repairedTeams
);
if (simBlockMessage) {
  releaseSimRunLock();
  openSimError(simBlockMessage, "Simulation blocked");
  return;
}

setActionModal(null);
setBoxModal(null);

  const pendingIntentBeforeRun = readPendingSimulationIntent();
  persistPendingSimIntent({
    mode: "full_season",
    targetDate: null,
    seasonYear,
    pausedReason: null,
    resumed: Boolean(resume),
  });

  // ✅ reset stop state at the start of a run
  stopRef.current = false;
  setStopRequested(false);

  // start with current stats
  let playerStats = loadPlayerStats();
  let clutchStats = loadClutchStats(seasonYear);



  setSimLock(true);
  console.log("🔥 FULL SEASON START");

  let upd = structuredClone(scheduleByDate);
  let results = structuredClone(resultsById);
  try {
    results = reconcileCompletedGamesWithCanonicalStorage(upd, results);
  } catch (error) {
    releaseSimRunLock();
    clearPendingSimIntent();
    openSimError(error?.message || "The schedule contains conflicting completed games.", "Season integrity issue");
    return;
  }
  const lockedGamesAtStart = snapshotLockedRegularSeasonGames(upd, results);
  const firstPendingTradeDate = findFirstPendingSimulationDate(upd, results);
  const runStartCursorDate = readSimulationCursorDate();
  const allowPreseasonCpuTrades = Boolean(firstPendingTradeDate && runStartCursorDate < firstPendingTradeDate);
  const simulationPerf = {
    mode: "full_season",
    targetDate: null,
    runId: createSimulationOrderRunId("full_season"),
    resumed: Boolean(resume),
    pendingIntentBeforeRun,
    startedAt: Date.now(),
    firstPendingDate: firstPendingTradeDate,
    runStartCursorDate,
    datesVisited: 0,
    historicalDatesSkipped: 0,
    deadlineDatesSkipped: 0,
    cpuTradePasses: 0,
    cpuTradeMs: 0,
    cpuTradesCompleted: 0,
    gamesSimmed: 0,
    gameOrderDateInversions: 0,
    gameExecutionSequence: 0,
    gameExecutionOrder: [],
    checkpointEvents: [],
  };

  let activeLeagueData = repairedLeagueData;
  let activeTeams = repairedTeams;
  let simRuntime = buildSimulationRuntime(activeLeagueData, activeTeams);

  const dates = Object.keys(upd).sort();
  let lastCpuTradePassDayIndex = null;
  let gamesSimmed = 0;
  let lastPersistedGames = 0;
  let lastDateProcessed = null;

// ✅ track if user stopped
let stopped = false;
let pausedForAllStar = false;
let pausedForTradeDeadline = false;
let pausedForContractExtensionDeadline = false;
let pausedForInjuryAlert = false;

  try {
for (let di = 0; di < dates.length; di++) {
  if (stopRef.current) { stopped = true; break; }

  const date = dates[di];
  if (date < runStartCursorDate) {
    simulationPerf.historicalDatesSkipped += 1;
    continue;
  }
  lastDateProcessed = date;
  simulationPerf.datesVisited += 1;

  const recovery = recoverPlayersForDate(activeLeagueData, date);
  if (recovery.touchedTeamNames.length) {
    const refreshed = refreshInjuryTouchedTeams(activeLeagueData, recovery.touchedTeamNames);
    if (refreshed) {
      activeTeams = refreshed.teams;
      simRuntime = refreshed.runtime;
    }
  }
  if (shouldPauseForUserInjuryEvents(recovery.events, {
    mode: "full_season",
    targetDate: null,
    seasonYear,
  })) {
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    cleanupGhostGames(upd, results);
    saveSchedule(upd);
    await saveResults(results);
    await flushPendingResultWrites();
    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(results));
    saveSimulationCursorDate(date);
    pausedForInjuryAlert = true;
    stopped = true;
    return;
  }

  if (shouldPauseForContractExtensionDeadline(date)) {
    recordSimulationCheckpointEvent(simulationPerf, {
      type: "pause",
      reason: "contract_extension_deadline",
      scheduledDate: date,
    });
    pausedForContractExtensionDeadline = true;
    break;
  }

  if (shouldPauseForTradeDeadline(date)) {
    recordSimulationCheckpointEvent(simulationPerf, {
      type: "pause",
      reason: "trade_deadline",
      scheduledDate: date,
    });
    pausedForTradeDeadline = true;
    break;
  }

  if (date === ALL_STAR_DATE && !allStarHandledRef.current) {
    recordSimulationCheckpointEvent(simulationPerf, {
      type: "pause",
      reason: "all_star",
      scheduledDate: date,
    });
    pausedForAllStar = true;
    break;
  }

  const cpuTradeDecision = getCpuTradeSimulationDateDecision({
    currentDate: date,
    firstPendingDate: firstPendingTradeDate,
    tradeDeadlineDate: TRADE_DEADLINE_DATE,
    preseasonTradeStartDate: fmt(seasonStart),
    allowPreseasonTrades: allowPreseasonCpuTrades,
  });
  const cpuTradePacing = getCpuTradeCalendarPacingDecision({
    bankState: activeLeagueData?.cpuTradeBankState,
    currentDate: date,
    dayIndex: di,
    tradeDeadlineDate: TRADE_DEADLINE_DATE,
    lastCpuTradePassDayIndex,
    basicDecision: cpuTradeDecision,
  });
  if (cpuTradeDecision.shouldRun && cpuTradePacing.shouldRun) {
    const cpuTradeStartedAt = Date.now();
    const cpuTradePass = await runCpuCpuTradePassForDate({
      activeLeagueData,
      currentDate: date,
      dayIndex: di,
      totalDates: dates.length,
      scheduleSnapshot: upd,
      resultsSnapshot: results,
      selectedTeam,
      setLeagueData,
      tradeDeadlineDate: TRADE_DEADLINE_DATE,
      firstPendingDate: firstPendingTradeDate,
      generationJobRef: cpuTradeGenerationJobRef,
      onTradeDeskEntries: handleTradeDeskEntries,
      onCpuTradeCompleted: showCpuTradeToast,
    });
    lastCpuTradePassDayIndex = di;
    simulationPerf.cpuTradePasses += 1;
    simulationPerf.cpuTradeMs += Date.now() - cpuTradeStartedAt;
    simulationPerf.cpuTradesCompleted += cpuTradePass?.tradesMade?.length || 0;
    bumpPerfCounter("cpuTrade.calendarPasses");
    if (cpuTradePass.leagueData !== activeLeagueData) {
      activeLeagueData = cpuTradePass.leagueData;
    }
    if (cpuTradePass.rosterChanged) {
      activeTeams = buildTeamsFromLeagueForSim(activeLeagueData);
      simRuntime = buildSimulationRuntime(activeLeagueData, activeTeams);
    }
  } else if (cpuTradeDecision.shouldRun) {
    bumpPerfCounter(`cpuTrade.calendarSkip.${cpuTradePacing.reason || "unknown"}`);
  } else if (cpuTradeDecision.reason === "historical_date_already_simulated") {
    simulationPerf.historicalDatesSkipped += 1;
  } else if (cpuTradeDecision.reason === "trade_deadline_locked") {
    simulationPerf.deadlineDatesSkipped += 1;
  }

  // Checkpoints/trades still run above, but dates whose games are already canonical
  // do not re-enter the expensive per-game storage/reconciliation path.
  if (!firstPendingTradeDate || date < firstPendingTradeDate) {
    simulationPerf.historicalDatesSkipped += 1;
    continue;
  }

  const dayGames = upd[date];
  if (!Array.isArray(dayGames)) {
    console.error("FULL SEASON FATAL: dayGames is not an array for", date, dayGames);
    break;
  }
  const dayMoodEvents = [];
  const dayResultUpdates = {};
  let dayChanged = false;

      if (window.__debugSimLogs) {
        console.log("📅 Processing date", di + 1, "of", dates.length, date, "games:", dayGames.length);
      }

      for (let i = 0; i < dayGames.length; i++) {
        if (stopRef.current) { stopped = true; break; }

        const g = dayGames[i];
        if (!g) {
          console.error("FULL SEASON FATAL: missing game object at", date, "index", i);
          stopped = true;
          break;
        }
        const storedExisting = loadOneResultV3(g.id);
        const canonicalExisting = hasUsableStoredResult(storedExisting)
          ? storedExisting
          : hasUsableStoredResult(results?.[g.id])
            ? results[g.id]
            : null;

        if (canonicalExisting) {
          results[g.id] = canonicalExisting;
          if (!g.played) dayGames[i] = { ...g, played: true };
          continue;
        }

        if (g.played) dayGames[i] = { ...g, played: false };

        const gameOrderEvent = startSimulationGameOrderEvent(simulationPerf, {
          scheduledDate: date,
          gameIndex: i,
          game: g,
        });

        try {
          const full = await runGameWithRetries(g, activeLeagueData, activeTeams, 3, simRuntime, date);
          if (!full) {
            finishSimulationGameOrderEvent(gameOrderEvent, "no_result");
            continue;
          }

          if (stopRef.current) {
            finishSimulationGameOrderEvent(gameOrderEvent, "stopped_after_worker");
            stopped = true;
            break;
          }

          const slim = slimResult(full);

const homeRoles = simRuntime.roleByTeam.get(g.home) || {};
const awayRoles = simRuntime.roleByTeam.get(g.away) || {};
          annotateSlimWithRoles(
            slim,
            homeRoles,
            awayRoles,
            simRuntime.orderByTeam.get(g.home) || [],
            simRuntime.orderByTeam.get(g.away) || []
          );

          const canonicalResult = await saveOneResultV3(
            g.id,
            slim,
            g,
            seasonYear,
            { deferIndexWrite: true }
          );

          if (!sameLockedScore(canonicalResult, slim)) {
            results[g.id] = canonicalResult;
            dayResultUpdates[g.id] = canonicalResult;
            dayGames[i] = { ...g, played: true };
            finishSimulationGameOrderEvent(gameOrderEvent, "canonical_restored");
            console.error("[FullSeason] restored canonical locked result instead of applying duplicate simulation", g.id);
            continue;
          }

          results[g.id] = canonicalResult || slim;
          dayResultUpdates[g.id] = canonicalResult || slim;

          dayGames[i] = { ...g, played: true };
          gamesSimmed++;
          simulationPerf.gamesSimmed += 1;
          finishSimulationGameOrderEvent(gameOrderEvent, "completed");

          const playerStatsBeforeGame = playerStats;
          playerStats = applyGameToPlayerStats(playerStats, slim, g);
          clutchStats = applyGameToClutchStats(clutchStats, slim, g, seasonYear);
          dayMoodEvents.push(...buildGamePerformanceMoodEvents(slim, g, date, {
            teams: activeTeams,
            scheduleByDate: upd,
            resultsById: results,
            playerStatsBefore: playerStatsBeforeGame,
            seasonYear,
          }));

          const injuryResult = processGameInjuries({
            leagueData: activeLeagueData,
            game: g,
            result: canonicalResult || slim,
            currentDate: date,
          });
          if (injuryResult.touchedTeamNames.length) {
            const refreshed = refreshInjuryTouchedTeams(activeLeagueData, injuryResult.touchedTeamNames);
            if (refreshed) {
              activeTeams = refreshed.teams;
              simRuntime = refreshed.runtime;
            }
          }

          dayChanged = true;

          if (shouldPauseForUserInjuryEvents(injuryResult.events, {
            mode: "full_season",
            targetDate: null,
            seasonYear,
          })) {
            upd[date] = dayGames;
            if (dayMoodEvents.length) appendPlayerMoodEvents(dayMoodEvents);
            savePlayerStats(playerStats);
            saveClutchStats(clutchStats);
            cleanupGhostGames(upd, results);
            saveSchedule(upd);
            await saveResults(results);
            await flushPendingResultWrites();
            setScheduleByDate(structuredClone(upd));
            setResultsById(structuredClone(results));
            saveSimulationCursorDate(date);
            pausedForInjuryAlert = true;
            stopped = true;
            return;
          }
        } catch (err) {
          finishSimulationGameOrderEvent(gameOrderEvent, "error", {
            message: String(err?.message || err || "unknown error"),
          });
          console.error("FULL SEASON ERROR for game", g.id, err);
        }
      }

      upd[date] = dayGames;
      if (dayMoodEvents.length) appendPlayerMoodEvents(dayMoodEvents);
      if (dayChanged) {
        setScheduleByDate((prev) => ({ ...prev, [date]: dayGames.slice() }));
        setResultsById((prev) => ({ ...prev, ...dayResultUpdates }));
        flushResultIndexCache();
      }
      await yieldToBrowser();

      if (stopped) break;

      if (gamesSimmed - lastPersistedGames >= 50) {
        saveSchedule(structuredClone(upd));
        savePlayerStats(playerStats);
        saveClutchStats(clutchStats);
        lastPersistedGames = gamesSimmed;
      }
    }
  } catch (err) {
    console.error(
      "FULL SEASON FATAL outer error:",
      err,
      "lastDateProcessed:",
      lastDateProcessed
    );
  } finally {
    // persist what we have so far
    const lastPlayedDate =
      getLastPlayedDateFromSchedule(upd) || lastDateProcessed;

    if (lastPlayedDate) {
      saveCalendarCursor(lastPlayedDate, monthKey(new Date(lastPlayedDate)));
      setFocusedDate(lastPlayedDate);
      setMonth(monthKey(new Date(lastPlayedDate)));
    }

    assertLockedRegularSeasonGamesUnchanged(
      lockedGamesAtStart,
      upd,
      results,
      pausedForContractExtensionDeadline ? "contract-extension deadline checkpoint" : pausedForTradeDeadline ? "trade-deadline checkpoint" : "full-season checkpoint"
    );
    saveSchedule(upd);
    await saveResults(results);
    await flushPendingResultWrites();
    try {
      await flushCpuTradeLeagueSaves();
    } catch (error) {
      console.warn("[CPU Trade Bank] failed to flush queued league saves", error);
    }
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    refreshTradeDeadlineLockFromSchedule(upd);

    recordSimulationPerformanceDiagnostics({
      ...simulationPerf,
      elapsedMs: Date.now() - simulationPerf.startedAt,
      stopped,
      pausedForTradeDeadline,
      pausedForContractExtensionDeadline,
      pausedForAllStar,
      pausedForInjuryAlert,
      lastDateProcessed,
    });

setActionModal(null);
releaseSimRunLock();

if (pausedForContractExtensionDeadline) {
  setScheduleByDate(structuredClone(upd));
  setResultsById(structuredClone(results));
  persistPendingSimIntent({
    mode: "full_season",
    targetDate: null,
    seasonYear,
    pausedReason: "contract_extension_deadline",
  });
  saveSimulationCursorDate(lastDateProcessed || readSimulationCursorDate());
  openContractExtensionDeadlinePrompt(lastDateProcessed || readSimulationCursorDate());
  return;
}

if (pausedForTradeDeadline) {
  setScheduleByDate(structuredClone(upd));
  setResultsById(structuredClone(results));
  persistPendingSimIntent({
    mode: "full_season",
    targetDate: null,
    seasonYear,
    pausedReason: "trade_deadline",
  });
  saveSimulationCursorDate(lastDateProcessed || readSimulationCursorDate());
  openTradeDeadlinePrompt();
  return;
}

if (pausedForAllStar) {
  setScheduleByDate(structuredClone(upd));
  setResultsById(structuredClone(results));
  persistPendingSimIntent({
    mode: "full_season",
    targetDate: null,
    seasonYear,
    pausedReason: "all_star",
  });
  saveSimulationCursorDate(lastDateProcessed || readSimulationCursorDate());
  setAllStarPromptOpen(true);
  return;
}

if (pausedForInjuryAlert) {
  setScheduleByDate(structuredClone(upd));
  setResultsById(structuredClone(results));
  saveSimulationCursorDate(lastDateProcessed || readSimulationCursorDate());
  return;
}

clearPendingSimIntent();

const nextPendingAfterRun = findFirstPendingSimulationDate(upd, results);
if (stopped) {
  saveSimulationCursorDate(nextPendingAfterRun || lastDateProcessed || readSimulationCursorDate());
} else {
  saveSimulationCursorDate(nextPendingAfterRun || getNextCalendarDateString(lastDateProcessed || fmt(seasonEnd)));
}

// ✅ If stopped, do NOT compute awards or navigate away
if (stopped) {
  console.log("🛑 FULL SEASON STOPPED by user at gamesSimmed:", gamesSimmed);
  return;
}

    const awards = await computeAndSaveCalendarAwards({
      playerStats,
      schedule: upd,
      results,
      activeTeams,
      gamesSimmed: countCompletedRegularSeasonGames(upd, results),
    });

    if (!awards?.mvp) {
      openSimError(
        "The regular season finished, but awards could not be generated because the final player-stat archive was incomplete. The game stayed on Calendar so no empty awards page is saved.",
        "Awards generation issue"
      );
      return;
    }

    navigate("/awards");

    console.log(
      "🏁 FULL SEASON EXIT, total gamesSimmed:",
      gamesSimmed,
      "last date processed:",
      lastDateProcessed
    );
  }
};







const resumePendingSimulation = async () => {
  const intent = readPendingSimulationIntent() || pendingSimIntent;
  if (!intent || simLock) return;

  if (Number(intent.seasonYear) !== Number(seasonYear)) {
    clearPendingSimIntent();
    return;
  }

  if (intent.mode === "full_season") {
    await handleSimSeason({ resume: true });
    return;
  }

  if (intent.mode === "to_date" && intent.targetDate) {
    await handleSimToDate(intent.targetDate, { resume: true });
  }
};

const closeAllStarTeams = () => {
  setAllStarOpen(false);
  if (readPendingSimulationIntent()) {
    window.setTimeout(() => {
      resumePendingSimulation();
    }, 0);
  }
};

const handleResetSeason = () => {
  if (!window.confirm("Reset season? ALL results + schedule will be wiped.")) return;

  // ✅ wipe all schedule/result/playoffs versions (so future key bumps don't break reset)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;

if (
  k.startsWith("bm_schedule_") ||
  k.startsWith("bm_results_") ||
  k.startsWith("bm_postseason_") ||
  k.startsWith("bm_champ_") ||
  k.startsWith("bm_trade_deadline_handled_v1_") ||
  k.startsWith("bm_contract_extension_deadline_handled_v1_") ||
  k.startsWith("bm_rookie_extension_deadline_handled_v1_") ||
  k.startsWith("bm_veteran_extension_deadline_handled_v1_") ||
  k.startsWith("bm_result_v3_") ||     // ✅ NEW
  k === "bm_results_index_v3" ||       // ✅ NEW
  k === "bm_trade_deadline_status_v1"
) {
  localStorage.removeItem(k);
}

  }

  clearBoxScoresFromDB().catch(() => {});
  resultIndexSetRef.current = new Set();
  resultIndexDirtyRef.current = false;
  boxScoreBatchRef.current = [];
  resultWriteQueueRef.current = Promise.resolve();

  // keep your player stats wipe
  localStorage.removeItem(PLAYER_STATS_KEY);
  localStorage.removeItem(AWARD_DISPLAY_STATS_KEY);
  localStorage.removeItem(CLUTCH_STATS_KEY);
  localStorage.removeItem("bm_all_stars_v1");
  localStorage.removeItem(TRADE_DESK_FEED_KEY);
  localStorage.removeItem(CALENDAR_CURSOR_KEY);
  localStorage.removeItem(CALENDAR_SIM_CURSOR_KEY);

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("bm_all_star_handled_v1_")) {
      localStorage.removeItem(k);
    }
  }

  allStarHandledRef.current = false;
tradeDeadlineHandledRef.current = false;
rookieExtensionDeadlineHandledRef.current = false;
veteranExtensionDeadlineHandledRef.current = false;
setAllStarPromptOpen(false);
setTradeDeadlinePromptOpen(false);
setContractExtensionPromptOpen(false);
setContractExtensionPromptInfo(null);
setAllStarOpen(false);
setAllStarData(null);
setShowAwardsPanel(false);
setMiniAwardTab("mvp");

  try {
    const resetLeague = structuredClone(leagueData || {});
    delete resetLeague.cpuTradeBankState;
    if (Array.isArray(resetLeague.tradeHistory)) {
      resetLeague.tradeHistory = resetLeague.tradeHistory.filter((row) => {
        const rowSeason = Number(row?.seasonYear ?? seasonYear);
        return rowSeason !== Number(seasonYear);
      });
    }
    setLeagueData(resetLeague);
    saveLeagueData(resetLeague).catch((error) => {
      console.warn("[Calendar] failed to save reset CPU trade state", error);
    });
  } catch (error) {
    console.warn("[Calendar] failed to reset CPU trade state", error);
  }

  const { byDate } = generateFullSeasonSchedule(teams, seasonStart, seasonEnd, seasonCalendarConfig);

  saveSchedule(byDate);
  setResultsById({});
  void saveResults({});

  const firstGameDate = Object.keys(byDate).sort()[0];
  setFocusedDate(firstGameDate);
  setMonth(monthKey(new Date(firstGameDate || seasonStart)));
  saveCalendarCursor(firstGameDate, monthKey(new Date(firstGameDate || seasonStart)));
  saveSimulationCursorDate(fmt(seasonStart));
};


// --------------------------------------------------------------------------
// DEV QUICK SIM TOOLS
// --------------------------------------------------------------------------
// Testing free agency/offseason bugs is painful if every run needs a real
// 82-game sim + All-Star pause + awards clickthrough. These dev-only buttons
// build a deterministic fake regular season from the current rosters, save the
// same schedule/result/player-stat keys the Calendar and Playoffs pages already
// read, then jump to the requested checkpoint.
const DEV_QUICK_SIM_TOOLS = true;

function devStableNumber(text) {
  let out = 0;
  const raw = String(text || "");
  for (let i = 0; i < raw.length; i++) {
    out = (out + raw.charCodeAt(i) * (i + 17)) % 1000003;
  }
  return out;
}

function devGetTeamStrength(teamName) {
  const team = teams.find((t) => t?.name === teamName);
  const players = Array.isArray(team?.players) ? team.players : [];
  const topEight = [...players]
    .map((p) => Number(p?.overall || p?.ovr || 65))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)
    .slice(0, 8);

  if (!topEight.length) return 72;
  return topEight.reduce((sum, value) => sum + value, 0) / topEight.length;
}

function devBuildSlimResult(game) {
  const homeStrength = devGetTeamStrength(game.home);
  const awayStrength = devGetTeamStrength(game.away);
  const seed = devStableNumber(game.id || `${game.home}-${game.away}`);

  let homeScore = 106 + Math.round((homeStrength - 75) * 0.72) + 3 + (seed % 13);
  let awayScore = 104 + Math.round((awayStrength - 75) * 0.72) + (Math.floor(seed / 13) % 13);

  if (homeScore === awayScore) {
    if (homeStrength >= awayStrength) homeScore += 1;
    else awayScore += 1;
  }

  const side = homeScore > awayScore ? "home" : "away";

  return {
    winner: {
      score: `${homeScore}-${awayScore}`,
      home: homeScore,
      away: awayScore,
      ot: 0,
      side,
    },
    totals: {
      home: homeScore,
      away: awayScore,
    },
    box: {
      home: [],
      away: [],
    },
    hasBoxScore: false,
  };
}

function devBuildPlayerStatsFromSchedule(schedule) {
  const gamesPlayedByTeam = {};

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.played) continue;
      gamesPlayedByTeam[game.home] = (gamesPlayedByTeam[game.home] || 0) + 1;
      gamesPlayedByTeam[game.away] = (gamesPlayedByTeam[game.away] || 0) + 1;
    }
  }

  const stats = {};
  const minutesByRole = [35, 33, 31, 29, 27, 24, 18, 14, 10, 8, 5, 4, 3, 2, 1];

  for (const team of teams || []) {
    const teamName = team?.name;
    if (!teamName) continue;

    const gp = Math.max(1, Number(gamesPlayedByTeam[teamName] || 0));
    const players = [...(team.players || [])].sort(
      (a, b) => Number(b?.overall || 0) - Number(a?.overall || 0)
    );

    players.forEach((player, idx) => {
      const name = player?.name || player?.player;
      if (!name) return;

      const overall = Number(player?.overall || player?.ovr || 70);
      const off = Number(player?.offRating || player?.off_rating || overall);
      const def = Number(player?.defRating || player?.def_rating || overall);
      const pos = String(player?.pos || player?.position || "").toUpperCase();
      const mpg = minutesByRole[idx] || 1;
      const starterBump = idx < 2 ? 3.5 : idx < 5 ? 1.4 : idx === 5 ? 2.2 : 0;

      const ppg = Math.max(
        1.2,
        2.5 + starterBump + (off - 60) * 0.35 + (overall - 70) * 0.12
      );

      const rpgBase = pos === "C" ? 8.8 : pos === "PF" ? 6.7 : pos === "SF" ? 4.8 : 3.0;
      const apgBase = pos === "PG" ? 6.4 : pos === "SG" ? 3.4 : pos === "SF" ? 2.7 : 1.6;
      const spg = Math.max(0.2, 0.5 + (def - 65) * 0.018);
      const bpg = Math.max(0.1, (pos === "C" ? 0.9 : pos === "PF" ? 0.55 : 0.25) + (def - 65) * 0.012);

      const pts = Math.round(ppg * gp);
      const reb = Math.round((rpgBase + Math.max(0, overall - 75) * 0.05) * gp);
      const ast = Math.round((apgBase + Math.max(0, off - 75) * 0.035) * gp);
      const stl = Math.round(spg * gp);
      const blk = Math.round(bpg * gp);

      const fga = Math.max(1, Math.round((ppg * 0.82 + 2.2) * gp));
      const fgm = Math.round(fga * Math.max(0.39, Math.min(0.57, 0.43 + (off - 70) * 0.003)));
      const tpa = Math.max(0, Math.round((pos === "C" ? 1.4 : pos === "PF" ? 2.4 : 4.4) * gp));
      const tpm = Math.round(tpa * Math.max(0.28, Math.min(0.43, 0.33 + (off - 72) * 0.0025)));
      const fta = Math.max(0, Math.round(ppg * 0.28 * gp));
      const ftm = Math.round(fta * 0.77);

      stats[`${name}__${teamName}`] = {
        player: name,
        team: teamName,
        gp,
        min: Math.round(mpg * gp),
        pts,
        reb,
        ast,
        stl,
        blk,
        fgm,
        fga,
        tpm,
        tpa,
        ftm,
        fta,
        started: idx < 5 ? gp : 0,
        sixth: idx >= 5 ? gp : 0,
      };
    });
  }

  return stats;
}

function devBuildClutchStatsFromSchedule(schedule, results, playerStats) {
  const clutchStats = createEmptyClutchStats(seasonYear);
  const teamClutch = {};

  const ensureTeamClutch = (teamName) => {
    if (!teamName) return null;
    teamClutch[teamName] ||= { clutchGames: 0, clutchWins: 0, clutchLosses: 0 };
    return teamClutch[teamName];
  };

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.played || !game?.id) continue;
      const result = results?.[game.id];
      const homeScore = Number(result?.totals?.home ?? result?.winner?.home ?? 0);
      const awayScore = Number(result?.totals?.away ?? result?.winner?.away ?? 0);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) continue;
      if (Math.abs(homeScore - awayScore) > 5) continue;

      const home = ensureTeamClutch(game.home);
      const away = ensureTeamClutch(game.away);
      if (!home || !away) continue;
      home.clutchGames += 1;
      away.clutchGames += 1;
      if (homeScore > awayScore) {
        home.clutchWins += 1;
        away.clutchLosses += 1;
      } else {
        away.clutchWins += 1;
        home.clutchLosses += 1;
      }
    }
  }

  clutchStats.teams = Object.fromEntries(
    Object.entries(teamClutch).map(([teamName, row]) => [
      teamName,
      { team: teamName, ...row },
    ])
  );

  const rosterByPlayerTeam = new Map();
  for (const team of teams || []) {
    for (const player of team?.players || []) {
      const name = player?.name || player?.player;
      if (!name || !team?.name) continue;
      rosterByPlayerTeam.set(`${name}__${team.name}`, player);
    }
  }

  const statFields = ["pts", "reb", "ast", "stl", "blk", "to"];
  const shootingFields = ["fgm", "fga", "tpm", "tpa", "ftm", "fta"];
  const blankTotals = () => ({
    gp: 0,
    min: 0,
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
  });

  for (const row of Object.values(playerStats || {})) {
    const playerName = row?.player;
    const teamName = row?.team;
    const totalGp = Number(row?.gp || 0);
    const teamRecord = teamClutch[teamName];
    if (!playerName || !teamName || totalGp <= 0 || !teamRecord?.clutchGames) continue;

    const clutchGp = Math.min(totalGp, Number(teamRecord.clutchGames || 0));
    const player = rosterByPlayerTeam.get(`${playerName}__${teamName}`) || {};
    const overall = Number(player?.overall || player?.ovr || 70);
    const seed = devStableNumber(`${playerName}-${teamName}-clutch`);
    const randomLift = ((seed % 19) - 9) / 100;
    const starLift = Math.max(-0.03, Math.min(0.10, (overall - 76) * 0.004));
    const performanceFactor = Math.max(0.84, Math.min(1.20, 1 + randomLift + starLift));
    const gpRatio = clutchGp / totalGp;

    const total = blankTotals();
    total.gp = totalGp;
    total.min = Number(row?.min || 0);
    for (const field of statFields) {
      const sourceField = field === "to" ? (row?.to ?? row?.tov ?? 0) : row?.[field];
      total[field === "to" ? "tov" : field] = Number(sourceField || 0);
    }
    for (const field of shootingFields) total[field] = Number(row?.[field] || 0);

    const clutch = blankTotals();
    clutch.gp = clutchGp;
    clutch.min = totalGp > 0 ? (total.min / totalGp) * clutchGp : 0;

    for (const field of ["pts", "reb", "ast", "stl", "blk", "tov"]) {
      clutch[field] = Math.min(total[field], total[field] * gpRatio * performanceFactor);
    }

    for (const attempts of ["fga", "tpa", "fta"]) {
      clutch[attempts] = Math.min(total[attempts], total[attempts] * gpRatio);
    }
    const shootingLift = Math.max(0.88, Math.min(1.15, performanceFactor));
    for (const [made, attempts] of [["fgm", "fga"], ["tpm", "tpa"], ["ftm", "fta"]]) {
      clutch[made] = Math.min(
        clutch[attempts],
        total[made],
        total[made] * gpRatio * shootingLift
      );
    }

    const nonClutch = blankTotals();
    nonClutch.gp = Math.max(0, total.gp - clutch.gp);
    nonClutch.min = Math.max(0, total.min - clutch.min);
    for (const field of ["pts", "reb", "ast", "stl", "blk", "tov", ...shootingFields]) {
      nonClutch[field] = Math.max(0, total[field] - clutch[field]);
    }

    clutchStats.players[playerName] = {
      player: playerName,
      latestTeam: teamName,
      teamNames: [teamName],
      total,
      clutch,
      nonClutch,
      clutchWins: Number(teamRecord.clutchWins || 0),
      clutchLosses: Number(teamRecord.clutchLosses || 0),
    };
  }

  clutchStats.processedGameIds = Object.values(schedule || {})
    .flat()
    .filter((game) => game?.played && game?.id)
    .map((game) => game.id);

  return clutchStats;
}

function devClearSeasonCheckpointState() {
  clearAllResultsV3();
  clearBoxScoresFromDB().catch(() => {});

  localStorage.removeItem(PLAYER_STATS_KEY);
  localStorage.removeItem(PENDING_SIM_INTENT_KEY);
  setPendingSimIntent(null);
  localStorage.removeItem("bm_all_stars_v1");
  localStorage.removeItem("bm_awards_latest");
  localStorage.removeItem("bm_awards_v1");
  localStorage.removeItem(AWARD_DISPLAY_STATS_KEY);
  localStorage.removeItem(CLUTCH_STATS_KEY);
  localStorage.removeItem("bm_postseason_v2");
  localStorage.removeItem("bm_champ_v1");
  localStorage.removeItem("bm_finals_mvp_v1");
  localStorage.removeItem("bm_finals_mvp_seen_v1");
  localStorage.removeItem(TRADE_DESK_FEED_KEY);
  localStorage.removeItem(TRADE_DEADLINE_STATUS_KEY);
  localStorage.removeItem(TRADE_DEADLINE_HANDLED_KEY);

  localStorage.setItem(ALL_STAR_HANDLED_KEY, "true");
  allStarHandledRef.current = true;
}

async function handleDevQuickSeasonJump(mode) {
  if (!acquireSimRunLock("DevQuickSim")) return;

  const label =
    mode === "last_game"
      ? "jump to the last user-team regular-season game"
      : mode === "awards"
      ? "jump to the awards page with a completed fake regular season"
      : "jump straight to the playoffs with a completed fake regular season";

  if (!window.confirm(`Dev quick sim will wipe current season results and ${label}. Continue?`)) {
    releaseSimRunLock();
    return;
  }

  setSimLock(true);
  setActionModal(null);
  setBoxModal(null);
  setAllStarPromptOpen(false);
  setAllStarOpen(false);

  try {
    devClearSeasonCheckpointState();

    const baseSchedule = Object.keys(scheduleByDate || {}).length
      ? structuredClone(scheduleByDate)
      : generateFullSeasonSchedule(teams, seasonStart, seasonEnd, seasonCalendarConfig).byDate;

    const dates = Object.keys(baseSchedule || {}).sort();
    const myId = selectedTeam?.name ? slugifyId(selectedTeam.name) : "";
    let holdGameId = null;
    let targetDate = dates[dates.length - 1] || fmt(seasonEnd);

    if (mode === "last_game") {
      for (let i = dates.length - 1; i >= 0; i--) {
        const date = dates[i];
        const games = baseSchedule?.[date] || [];
        const userGame = [...games]
          .reverse()
          .find((game) => game?.homeId === myId || game?.awayId === myId);

        if (userGame) {
          holdGameId = userGame.id;
          targetDate = date;
          break;
        }
      }
    }

    const nextSchedule = {};
    const nextResults = {};
    let gamesCompleted = 0;

    for (const date of dates) {
      nextSchedule[date] = (baseSchedule[date] || []).map((game) => {
        if (!game?.id) return game;

        const leaveUnplayed = mode === "last_game" && game.id === holdGameId;
        if (leaveUnplayed) {
          return { ...game, played: false };
        }

        const result = devBuildSlimResult(game);
        nextResults[game.id] = result;
        gamesCompleted += 1;
        return { ...game, played: true };
      });
    }

    const playerStats = devBuildPlayerStatsFromSchedule(nextSchedule);
    const clutchStats = devBuildClutchStatsFromSchedule(nextSchedule, nextResults, playerStats);
    savePlayerStats(playerStats);
    saveClutchStats(clutchStats);
    saveSchedule(nextSchedule);
    await saveResults(nextResults, { persistBoxes: true });
    await flushPendingResultWrites();

    setScheduleByDate(structuredClone(nextSchedule));
    setResultsById(structuredClone(nextResults));
    setFocusedDate(targetDate);
    setMonth(monthKey(new Date(targetDate || seasonEnd)));
    saveCalendarCursor(targetDate, monthKey(new Date(targetDate || seasonEnd)));

    if (mode === "awards") {
      await computeAndSaveCalendarAwards({
        playerStats,
        schedule: nextSchedule,
        results: nextResults,
        activeTeams: teams,
        gamesSimmed: gamesCompleted,
      });
      navigate("/awards");
      return;
    }

    if (mode === "playoffs") {
      await finalizeCompletedRegularSeasonPlayerCardsAfterAwards({
        awards: null,
        schedule: nextSchedule,
        results: nextResults,
        activeTeams: teams,
        playerStats,
      });
      navigate("/playoffs");
    }
  } catch (err) {
    console.error("[DevQuickSim] failed", err);
    openSimError(err?.message || "Dev quick sim failed.", "Dev quick sim failed");
  } finally {
    releaseSimRunLock();
  }
}




/* -------------------------------------------------------------------------- */
/*                                    UI                                      */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/*                      HEADER (Season / Record / Standings)                  */
/* -------------------------------------------------------------------------- */
const confByTeam = useMemo(() => {
  const map = {};
  const confs = leagueData?.conferences || {};
  for (const [conf, arr] of Object.entries(confs)) {
    for (const t of arr || []) {
      if (t?.name) map[t.name] = conf;
    }
  }
  return map;
}, [leagueData]);

const teamAgg = useMemo(() => {
  const totals = {};
  const ensure = (teamName) => {
    if (!totals[teamName]) {
      totals[teamName] = { team: teamName, w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    }
    return totals[teamName];
  };

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      if (!g?.played) continue;
      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      const homeName = g.home;
      const awayName = g.away;

      const homePts = Number(r.totals.home ?? 0);
      const awayPts = Number(r.totals.away ?? 0);

      const homeRow = ensure(homeName);
      const awayRow = ensure(awayName);

      homeRow.gp += 1;
      awayRow.gp += 1;

      homeRow.pf += homePts;
      homeRow.pa += awayPts;

      awayRow.pf += awayPts;
      awayRow.pa += homePts;

      if (homePts > awayPts) {
        homeRow.w += 1;
        awayRow.l += 1;
      } else if (awayPts > homePts) {
        awayRow.w += 1;
        homeRow.l += 1;
      }
    }
  }

  return totals;
}, [scheduleByDate, resultsById]);

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const headerInfo = useMemo(() => {
  const seasonLabel = `${seasonYear}-${seasonYear + 1}`;

  const myName = selectedTeam?.name;
  const myConf = confByTeam?.[myName] || "";

  const myRow = teamAgg?.[myName] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
  const w = myRow.w || 0;
  const l = myRow.l || 0;

  // standings in conference (pct desc, then diff desc)
  const confTeams = Object.keys(confByTeam || {}).filter((t) => confByTeam[t] === myConf);
  const rows = confTeams.map((t) => {
    const r = teamAgg?.[t] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    const gp = (r.w || 0) + (r.l || 0);
    const pct = gp > 0 ? (r.w / gp) : 0;
    const diff = (r.pf || 0) - (r.pa || 0);
    return { team: t, w: r.w || 0, l: r.l || 0, pct, diff };
  });

  rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff);
  const confRank = myName ? (rows.findIndex((x) => x.team === myName) + 1) : 0;

  // Off/Def ranks in league (Off: PF/G desc, Def: PA/G asc)
  const leagueTeams = Object.keys(confByTeam || {});
  const offRows = leagueTeams.map((t) => {
    const r = teamAgg?.[t] || { pf: 0, pa: 0, gp: 0, w: 0, l: 0 };
    const gp = r.gp || ((r.w || 0) + (r.l || 0)) || 0;
    const pfpg = gp > 0 ? (r.pf / gp) : 0;
    return { team: t, val: pfpg };
  }).sort((a, b) => b.val - a.val);

  const defRows = leagueTeams.map((t) => {
    const r = teamAgg?.[t] || { pf: 0, pa: 0, gp: 0, w: 0, l: 0 };
    const gp = r.gp || ((r.w || 0) + (r.l || 0)) || 0;
    const papg = gp > 0 ? (r.pa / gp) : 0;
    return { team: t, val: papg };
  }).sort((a, b) => a.val - b.val);

  const offRank = myName ? (offRows.findIndex((x) => x.team === myName) + 1) : 0;
  const defRank = myName ? (defRows.findIndex((x) => x.team === myName) + 1) : 0;

  return {
    seasonLabel,
    w,
    l,
    conf: myConf,
    confRank,
    offRank,
    defRank,
  };
}, [seasonYear, selectedTeam, confByTeam, teamAgg]);

const conferenceStandings = useMemo(() => {
  const rows = teams.map((t) => {
    const agg = teamAgg?.[t.name] || { w: 0, l: 0, pf: 0, pa: 0 };
    const gp = (agg.w || 0) + (agg.l || 0);

    return {
      team: t.name,
      conf: String(confByTeam?.[t.name] || ""),
      logo:
        t.logo ||
        t.teamLogo ||
        t.newTeamLogo ||
        t.logoUrl ||
        t.image ||
        t.img ||
        "",
      w: agg.w || 0,
      l: agg.l || 0,
      pct: gp > 0 ? agg.w / gp : 0,
      diff: (agg.pf || 0) - (agg.pa || 0),
    };
  });

  const sorter = (a, b) =>
    b.pct - a.pct || b.diff - a.diff || a.team.localeCompare(b.team);

  return {
    west: rows
      .filter((row) => row.conf.toLowerCase() === "west")
      .sort(sorter),
    east: rows
      .filter((row) => row.conf.toLowerCase() === "east")
      .sort(sorter),
  };
}, [teams, teamAgg, confByTeam]);

const livePlayerStats = useMemo(() => {
  return loadPlayerStats();
}, [scheduleByDate, resultsById]);

const miniAwardLadders = useMemo(() => {
  return buildMiniAwardLadders(
    teams,
    livePlayerStats,
    scheduleByDate,
    resultsById
  );
}, [teams, livePlayerStats, scheduleByDate, resultsById]);

const cycleMiniAwardTab = (dir) => {
  setMiniAwardTab((prev) => {
    const i = MINI_AWARD_TABS.indexOf(prev);
    if (i === -1) return "mvp";

    if (dir === "next") {
      return MINI_AWARD_TABS[(i + 1) % MINI_AWARD_TABS.length];
    }

    return MINI_AWARD_TABS[
      (i - 1 + MINI_AWARD_TABS.length) % MINI_AWARD_TABS.length
    ];
  });
};

/* -------------------------------------------------------------------------- */
/*                               CALENDAR GRID                                */
/* -------------------------------------------------------------------------- */
const nextPendingSimulationDate = useMemo(
  () => findFirstPendingSimulationDate(scheduleByDate, resultsById),
  [scheduleByDate, resultsById]
);
const currentSimulationCursorDate = useMemo(
  () => readSimulationCursorDate(),
  [scheduleByDate, resultsById, CALENDAR_SIM_CURSOR_KEY, seasonStart]
);

const actionModalBackwardsMessage = actionModal
  ? actionModal.dateStr < currentSimulationCursorDate
    ? `Already simulated past this date. Next unsimulated date is ${currentSimulationCursorDate}.`
    : !nextPendingSimulationDate
      ? "Regular season is already complete."
      : ""
  : "";

const actionModalBlockMessage = actionModal
  ? getSimulationBlockMessageForGame(actionModal.game, teams)
  : "";

// Keep all hooks above these loading/selection guards. React requires every
// render of Calendar to call hooks in the same order, including the first
// render while GameContext is still hydrating leagueData.
if (!leagueData) {
  return <div className="text-white p-6">Loading league...</div>;
}
if (!selectedTeam) {
  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center">
      <p>No team selected.</p>
      <button
        className="mt-4 px-4 py-2 bg-orange-600 rounded"
        onClick={() => navigate("/team-selector")}
      >
        Pick a Team
      </button>
    </div>
  );
}

return (
    <PageFade>
  <div
    className="relative h-screen overflow-hidden text-white py-2"
    style={{
      background: `
        repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 28px),
        repeating-linear-gradient(-45deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 22px),
        radial-gradient(circle at 50% 30%, #2b2b2b 0%, #0d0d0d 80%)
      `,
    }}
  >
    <div
      className="pointer-events-none absolute -inset-[120px] z-0"
      style={{
        backgroundImage: `
          conic-gradient(from 210deg at 18% 22%,
            rgba(255,255,255,0.16) 0deg,
            rgba(255,255,255,0.08) 14deg,
            rgba(255,255,255,0.00) 36deg 360deg),
          conic-gradient(from 30deg at 82% 78%,
            rgba(255,255,255,0.14) 0deg,
            rgba(255,255,255,0.07) 16deg,
            rgba(255,255,255,0.00) 38deg 360deg)
        `,
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundSize: "760px 760px, 700px 700px",
        backgroundPosition: "left -120px top -80px, right -90px bottom -60px",
        filter: "blur(20px)",
        opacity: 0.26,
      }}
    />



<style>
  {`
    @keyframes calendarBgDrift {
      0% { transform: translate(0, 0) rotate(0deg); }
      50% { transform: translate(-100px, -60px) rotate(1deg); }
      100% { transform: translate(0, 0) rotate(0deg); }
    }

    .orange-scrollbar {
      scrollbar-width: auto;
      scrollbar-color: #f97316 #171717;
    }

    .orange-scrollbar::-webkit-scrollbar {
      width: 16px;
      height: 16px;
    }

    .orange-scrollbar::-webkit-scrollbar-track {
      background: #171717;
      border-radius: 8px;
    }

    .orange-scrollbar::-webkit-scrollbar-thumb {
      background: #f97316;
      border-radius: 6px;
      border: 2px solid #171717;
    }

    .orange-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #ea580c;
    }

    .standings-scrollbar {
      scrollbar-width: auto;
      scrollbar-color: #f97316 #171717;
      scrollbar-gutter: stable;
    }

    .standings-scrollbar::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    .standings-scrollbar::-webkit-scrollbar-track {
      background: #171717;
      border-radius: 8px;
    }

    .standings-scrollbar::-webkit-scrollbar-thumb {
      background: #f97316;
      border-radius: 6px;
      border: 2px solid #171717;
    }

    .standings-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #fb923c;
    }
  `}
</style>
    <MiniStandingsPanel
      title="West"
      rows={conferenceStandings.west}
      selectedTeamName={calendarViewTeam?.name || selectedTeam.name}
      hidden={!showWestStandings}
      onToggle={() => setShowWestStandings((v) => !v)}
      collapsedLabel="Show West"
      side="left"
    />

<MiniStandingsPanel
  title="East"
  rows={conferenceStandings.east}
  selectedTeamName={calendarViewTeam?.name || selectedTeam.name}
  hidden={!showEastStandings}
  onToggle={() => setShowEastStandings((v) => !v)}
  collapsedLabel="Show East"
  side="right"
  awardsEnabled={true}
  showAwards={showAwardsPanel}
  onToggleAwards={() => setShowAwardsPanel((v) => !v)}
  awardTab={miniAwardTab}
  awardRows={miniAwardLadders[miniAwardTab] || []}
  onPrevAward={() => cycleMiniAwardTab("prev")}
  onNextAward={() => cycleMiniAwardTab("next")}
/>

<div
  className="relative z-10 mx-auto h-full flex flex-col px-3"
  style={{
    width: "min(72vw, 1320px)",
    transformOrigin: "top center",
  }}
>
        {/* HEADER */}
        {/* HEADER */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          {/* left: team switch + logo + name */}
          <div className="flex items-center gap-4">
            <button
              className="text-2xl hover:text-orange-400"
              onClick={() => handleTeamSwitch("prev")}
            >
              ◄
            </button>
            <button
              className="text-2xl hover:text-orange-400"
              onClick={() => handleTeamSwitch("next")}
            >
              ►
            </button>

            <div className="flex items-center gap-3">
              <Logo team={calendarViewTeam || selectedTeam} size={72} />
              <h1 className="text-2xl font-bold text-orange-500">
                {(calendarViewTeam || selectedTeam).name}
              </h1>
            </div>
          </div>

          {/* right: controls */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {simLock && (
  <>
    <button
      className="px-3 py-2 bg-neutral-600 rounded opacity-80 cursor-not-allowed"
      disabled
      title="Simulation in progress"
    >
      Simulating…
    </button>

    <button
      className={`px-3 py-2 rounded ${stopRequested ? "bg-yellow-900 opacity-70 cursor-not-allowed" : "bg-yellow-600"}`}
      disabled={stopRequested}
      onClick={requestStop}
      title="Stop simulation"
    >
      {stopRequested ? "Stopping…" : "Stop"}
    </button>
  </>
)}

<button
  className="px-3 py-2 bg-red-700 rounded"
  onClick={handleResetSeason}
>
  Reset Season
</button>


{DEV_QUICK_SIM_TOOLS && (
  <>
    <button
      className="px-3 py-2 bg-purple-800 hover:bg-purple-700 rounded text-xs font-bold disabled:opacity-50"
      disabled={simLock}
      onClick={() => handleDevQuickSeasonJump("last_game")}
      title="Dev only: fake-sim to the final user-team regular-season game and leave that game unplayed."
    >
      Dev Last Game
    </button>

    <button
      className="px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded text-xs font-bold disabled:opacity-50"
      disabled={simLock}
      onClick={() => handleDevQuickSeasonJump("playoffs")}
      title="Dev only: fake-complete the regular season and jump straight to playoffs."
    >
      Dev Playoffs
    </button>

    <button
      className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold disabled:opacity-50"
      disabled={simLock}
      onClick={() => handleDevQuickSeasonJump("awards")}
      title="Dev only: fake-complete the regular season, compute awards, and jump to awards."
    >
      Dev Awards
    </button>
  </>
)}


            {/* Month navigation */}
            <button
              className="px-3 py-2 bg-neutral-700 rounded"
              onClick={() => {
                const i = months.indexOf(month);
                if (i > 0) scrollToMonth(months[i - 1]);
              }}
            >
              ‹ Prev
            </button>
            <select
              value={month}
              onChange={(e) => scrollToMonth(e.target.value)}
              className="px-3 py-2 bg-neutral-800 rounded"
            >
              {months.map((m) => {
                const [y, mm] = m.split("-").map(Number);
                const dt = new Date(y, mm - 1, 1);
                return (
                  <option key={m} value={m}>
                    {dt.toLocaleString("default", {
                      month: "long",
                      year: "numeric",
                    })}
                  </option>
                );
              })}
            </select>
            <button
              className="px-3 py-2 bg-neutral-700 rounded"
              onClick={() => {
                const i = months.indexOf(month);
                if (i < months.length - 1) scrollToMonth(months[i + 1]);
              }}
            >
              Next ›
            </button>
          </div>
        </div>

        {/* BANNER */}
        <div className="mb-4 px-4 py-2 bg-neutral-800 rounded-xl border-2 border-white">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-gray-200">
              Season {headerInfo.seasonLabel}
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              Record{" "}
              <span className="font-bold text-green-400">{headerInfo.w}</span>
              <span className="text-gray-300">-</span>
              <span className="font-bold text-red-400">{headerInfo.l}</span>
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              {headerInfo.confRank ? `${ordinal(headerInfo.confRank)} in ${headerInfo.conf}` : `— in ${headerInfo.conf || "—"}`}
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              Off Rank {headerInfo.offRank ? `#${headerInfo.offRank}` : "—"}
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              Def Rank {headerInfo.defRank ? `#${headerInfo.defRank}` : "—"}
            </span>
          </div>
        </div>

        {/* SCROLLABLE CALENDAR AREA */}
        <div ref={calendarScrollRef} className="flex-1 min-h-0 overflow-y-auto orange-scrollbar pr-1">
          <div className="space-y-4 pb-4">
            {months.map((monthStr) => {
              const monthDays = visibleDaysByMonth[monthStr] || [];
              const [y, m] = monthStr.split("-").map(Number);
              const monthDate = new Date(y, m - 1, 1);
              const isSelectedMonth = month === monthStr;

              return (
                <div
                  key={monthStr}
                  ref={(el) => {
                    monthRefs.current[monthStr] = el;
                  }}
className={`rounded-xl border-2 p-3 transition-colors duration-200 ${
  isSelectedMonth
    ? "border-orange-500 ring-1 ring-orange-500/60"
    : "border-white/70 hover:border-orange-500"
}`}
                >
                  <div className="mb-3">
                    <h2
                      className={`text-xl font-bold ${
                        isSelectedMonth ? "text-orange-400" : "text-gray-200"
                      }`}
                    >
                      {monthDate.toLocaleString("default", {
                        month: "long",
                        year: "numeric",
                      })}
                    </h2>
                  </div>

                  <div className="grid grid-cols-7 text-center text-gray-400 mb-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
                      <div key={w}>{w}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1.5">
                    {monthDays.map((d, idx) => {
                      if (!d) {
                        return (
                          <div
                            key={"pad-" + monthStr + "-" + idx}
                            className="h-36 bg-neutral-800/40 rounded-lg border border-neutral-800"
                          />
                        );
                      }

                      const dateStr = fmt(d);
                      const game = myGames[dateStr] || null;
                      const result = game ? resultsById[game.id] : null;
                      const isTradeDeadline = userTradeDeadlineEnabled && dateStr === TRADE_DEADLINE_DATE;
                      const contractExtensionDayInfo = getContractExtensionDeadlineInfo(dateStr);
                      const isRookieExtensionDeadline = contractExtensionDayInfo?.type === "rookie";
                      const isVeteranExtensionDeadline = contractExtensionDayInfo?.type === "veteran";
                      const isContractExtensionDeadline = Boolean(contractExtensionDayInfo);
                      const isAllStarDate = dateStr === ALL_STAR_DATE;
                      const isAllStarBreakDate =
                        dateStr >= String(seasonCalendarConfig.allStarStart || ALL_STAR_DATE) &&
                        dateStr <= String(seasonCalendarConfig.allStarEnd || ALL_STAR_DATE);
                      const hasLeagueGames = Array.isArray(scheduleByDate?.[dateStr]) && scheduleByDate[dateStr].length > 0;

                      const finalScore =
                        game && game.played && result
                          ? `${result.totals?.home}-${result.totals?.away}`
                          : null;

                      const iAmHome =
                        game && game.homeId === slugifyId((calendarViewTeam || selectedTeam).name);

                      const winnerSide = result?.winner?.side || null;

                      const outcome =
                        game && game.played && winnerSide && winnerSide !== "tie"
                          ? winnerSide === (iAmHome ? "home" : "away")
                            ? "W"
                            : "L"
                          : null;

                      return (
                        <div
                          key={monthStr + "-" + dateStr}
                          className={`relative h-36 rounded-lg border cursor-pointer overflow-hidden px-2.5 pb-2 pt-2 ${
                            game
                              ? iAmHome
                                ? "border-blue-400"
                                : "border-red-400"
                              : "border-neutral-700"
                          } bg-neutral-850 hover:bg-neutral-700`}
                          onClick={() => {
                            setFocusedDate(dateStr);
                            setMonth(monthStr);
                            saveCalendarCursor(dateStr, monthStr);
                            setActionModal({
                              dateStr,
                              game,
                              hasLeagueGames,
                              event: isContractExtensionDeadline
                                ? (isRookieExtensionDeadline ? "rookie_extension_deadline" : "veteran_extension_deadline")
                                : isTradeDeadline
                                  ? "trade_deadline"
                                  : isAllStarDate
                                    ? "all_star"
                                    : isAllStarBreakDate
                                      ? "all_star_break"
                                      : null,
                            });
                          }}
                        >
                          <div className="text-xs text-gray-400">{d.getDate()}</div>

                          {(isContractExtensionDeadline || isTradeDeadline || isAllStarDate || (!game && isAllStarBreakDate)) && (
                            <div className={`mt-2 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                              isContractExtensionDeadline
                                ? "border-emerald-500/60 bg-emerald-600/20 text-emerald-200"
                                : isTradeDeadline
                                ? "border-orange-500/60 bg-orange-600/20 text-orange-200"
                                : isAllStarDate
                                  ? "border-sky-400/60 bg-sky-600/20 text-sky-200"
                                  : "border-white/15 bg-white/5 text-white/45"
                            }`}>
                              {isContractExtensionDeadline ? contractExtensionDayInfo.label : isTradeDeadline ? "Trade Deadline" : isAllStarDate ? "All-Star Game" : "All-Star Break"}
                            </div>
                          )}

                          {game && (
                            <div className="mt-2 flex min-h-[54px] items-center gap-2.5 pr-1">
                              <div className="shrink-0 rounded-md bg-black/20 p-1">
                                <Logo
                                  team={{
                                    name: iAmHome ? game.away : game.home,
                                    logo: iAmHome ? game.awayLogo : game.homeLogo,
                                  }}
                                  size={28}
                                />
                              </div>

                              <span
                                className="text-[14px] font-black tracking-wide text-white/90"
                                title={iAmHome ? game.away : game.home}
                              >
                                {getTeamAbbreviation(iAmHome ? game.away : game.home)}
                              </span>
                            </div>
                          )}

                          {game && game.played && (outcome || finalScore) && (
                            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                              {outcome ? (
                                <div
                                  className={`flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[11px] font-black ${
                                    outcome === "W" ? "bg-green-700" : "bg-red-700"
                                  }`}
                                >
                                  {outcome}
                                </div>
                              ) : <span />}

                              {finalScore ? (
                                <div className="shrink-0 whitespace-nowrap rounded-md bg-emerald-700/90 px-2 py-1 text-[10px] font-bold">
                                  {finalScore}
                                  {Number(result?.winner?.ot ?? result?.periods?.otCount ?? 0) > 0
                                    ? ` · ${Number(result?.winner?.ot ?? result?.periods?.otCount) === 1 ? "OT" : `${Number(result?.winner?.ot ?? result?.periods?.otCount)}OT`}`
                                    : ""}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
                  </div>

{/* ---------------------------- ACTION MODAL ---------------------------- */}
{actionModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
      onClick={() => setActionModal(null)}
    >
      <div
        className="w-full max-w-[500px] rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-white">
          {actionModal.game
            ? `${actionModal.game.away} @ ${actionModal.game.home}`
            : actionModal.event === "rookie_extension_deadline"
              ? "Rookie Extension Deadline"
              : actionModal.event === "veteran_extension_deadline"
                ? "Veteran Extension Deadline"
                : actionModal.event === "contract_extension_deadline"
                  ? "Contract Extension Deadline"
                  : actionModal.event === "trade_deadline"
                    ? "Trade Deadline"
                    : actionModal.event === "all_star"
                      ? "All-Star Game"
                      : `Sim to ${actionModal.dateStr}`}
        </h2>

        {(!actionModal.game || !actionModal.game.played) ? (
          <div className="flex flex-col gap-2">
            {actionModal.game ? (
              <button
                className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
                onClick={() =>
                  handleSimOnlyGame(actionModal.dateStr, actionModal.game)
                }
              >
                Simulate this game
              </button>
            ) : (
              <div className="rounded-lg border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-300">
                {actionModalBackwardsMessage || "No selected-team game on this date. You can still simulate the league to this day."}
              </div>
            )}

{actionModalBackwardsMessage ? (
  <button
    className="cursor-not-allowed rounded bg-neutral-700/70 px-4 py-2 text-neutral-400"
    disabled
    title={actionModalBackwardsMessage}
  >
    Cannot simulate backwards
  </button>
) : (
  <button
    className={`px-4 py-2 rounded transition ${
      selectedTeamCanSim
        ? "bg-orange-600 hover:bg-orange-500"
        : "bg-orange-600 hover:bg-orange-500 ring-1 ring-orange-300/30"
    }`}
    onClick={() => handleSimToDate(actionModal.dateStr)}
    title={
      !selectedTeamCanSim
        ? selectedTeamSimBlockMessage
        : ""
    }
  >
    Simulate to this date
  </button>
)}

<button
  className={`px-4 py-2 rounded transition ${
    selectedTeamCanSim
      ? "bg-blue-600 hover:bg-blue-500"
      : "bg-blue-600 hover:bg-blue-500 ring-1 ring-blue-300/30"
  }`}
  onClick={() => handleSimSeason()}
  title={
    !selectedTeamCanSim
      ? selectedTeamSimBlockMessage
      : ""
  }
>
  Simulate full season
</button>

            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() => setActionModal(null)}
            >
              Close
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() => openBoxScoreForGame(actionModal.game)}
            >
              View Box Score
            </button>

            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() => setActionModal(null)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )}

{/* ---------------------------- SIM ERROR MODAL ---------------------------- */}
{simErrorModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[205] bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => setSimErrorModal(null)}
    >
      <div
        className="w-full max-w-[460px] rounded-2xl border border-orange-500/40 bg-neutral-900 shadow-[0_0_30px_rgba(0,0,0,0.55)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-600/20 to-red-500/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-orange-400/40 bg-orange-500/15 text-xl">
              !
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">
                {simErrorModal.title || "Cannot simulate"}
              </h3>
              <p className="text-sm text-orange-200/80">
                Fix the roster issue before continuing
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-xl border border-neutral-700 bg-neutral-850 px-4 py-3 text-sm leading-6 text-neutral-200">
            {simErrorModal.message}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              className="px-4 py-2 rounded-lg bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
              onClick={() => setSimErrorModal(null)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )}

{/* ---------------------------- BOX SCORE MODAL ---------------------------- */}
{boxModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/78 p-2"
      onClick={() => setBoxModal(null)}
    >
      <div
        className="flex w-[97vw] max-w-[1700px] flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-white shadow-2xl"
        style={{ maxHeight: "calc(100dvh - 20px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-4">
          <h3 className="min-w-0 truncate text-lg font-black">
            {boxModal.game.away} @ {boxModal.game.home} • {boxModal.result?.winner?.score}
            {formatOTLabel(boxModal.result?.winner?.ot ?? boxModal.result?.periods?.otCount)}
          </h3>

          <button
            className="shrink-0 rounded bg-neutral-700 px-3 py-1.5 text-sm font-bold hover:bg-neutral-600"
            onClick={() => setBoxModal(null)}
          >
            Close
          </button>
        </div>

        {boxModal.result?.periods &&
          (() => {
            const periods = boxModal.result.periods;
            const awayQ = Array.isArray(periods.away) ? periods.away : [];
            const homeQ = Array.isArray(periods.home) ? periods.home : [];
            const awayOts = Array.isArray(periods.ots?.away) ? periods.ots.away : [];
            const homeOts = Array.isArray(periods.ots?.home) ? periods.ots.home : [];
            const otCount = Number(periods.otCount || Math.max(awayOts.length, homeOts.length, 0));
            const hasIndividualOts = awayOts.length > 0 || homeOts.length > 0;
            const displayOtCount = Math.min(hasIndividualOts ? otCount : otCount > 0 ? 1 : 0, 6);
            const legacyOtAway = Number(periods.otBreakdown?.away || 0);
            const legacyOtHome = Number(periods.otBreakdown?.home || 0);

            const qVal = (arr, idx) =>
              arr[idx] != null && Number.isFinite(Number(arr[idx])) ? Number(arr[idx]) : "—";
            const otVal = (arr, idx, legacyValue) => {
              if (hasIndividualOts) return qVal(arr, idx);
              return idx === 0 && legacyValue ? legacyValue : "—";
            };
            const otHeader = (idx) => (idx === 0 ? "OT" : `${idx + 1}OT`);

            return (
              <div className="mb-2 shrink-0 rounded-lg bg-neutral-800 px-3 py-2">
                <table className="w-full table-fixed text-center text-[11px]">
                  <thead className="text-gray-300">
                    <tr className="border-b border-neutral-700">
                      <th className="w-[24%] py-1 text-left">Team</th>
                      <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>
                      {Array.from({ length: displayOtCount }, (_, idx) => (
                        <th key={`ot-head-${idx}`}>{otHeader(idx)}</th>
                      ))}
                      <th>Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["away", boxModal.game.away, awayQ, awayOts, legacyOtAway, boxModal.result?.totals?.away],
                      ["home", boxModal.game.home, homeQ, homeOts, legacyOtHome, boxModal.result?.totals?.home],
                    ].map(([side, name, quarters, ots, legacyOt, total]) => (
                      <tr key={side} className="border-b border-neutral-800 last:border-0">
                        <td className="truncate py-1 text-left font-bold" title={name}>{name}</td>
                        <td>{qVal(quarters, 0)}</td><td>{qVal(quarters, 1)}</td>
                        <td>{qVal(quarters, 2)}</td><td>{qVal(quarters, 3)}</td>
                        {Array.from({ length: displayOtCount }, (_, idx) => (
                          <td key={`${side}-ot-${idx}`}>{otVal(ots, idx, legacyOt)}</td>
                        ))}
                        <td className="font-black">{total ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

        <div className="grid min-h-0 grid-cols-2 gap-3">
          {["away", "home"].map((side) => {
            const name = side === "away" ? boxModal.game.away : boxModal.game.home;
            const fallbackTeam = teams.find((team) => team?.name === name);
            const fallbackOrder = readGameplanOrder(name, fallbackTeam);
            const rows = sortBoxRowsByFrozenRotation(
              boxModal.result?.box?.[side] || [],
              boxModal.result?.rotationOrder?.[side] || [],
              fallbackOrder
            );

            return (
              <div key={side} className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-neutral-800 p-2">
                <h4 className="mb-1 shrink-0 truncate text-sm font-black" title={name}>{name}</h4>
                <table className="w-full table-fixed text-[10px] leading-tight">
                  <colgroup>
                    <col style={{ width: "27%" }} />
                    {Array.from({ length: 11 }, (_, idx) => <col key={idx} />)}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-neutral-700 text-white/70">
                      <th className="px-1 py-1 text-left">Player</th>
                      {['MIN','PTS','REB','AST','STL','BLK','FG','3P','FT','TO','PF'].map((label) => (
                        <th key={label} className="px-0.5 text-center">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((player, index) => {
                      const dnp = Number(player?.min || 0) <= 0;
                      const stat = (value) => (dnp ? "—" : value ?? 0);
                      return (
                        <tr key={`${player?.player || "player"}-${index}`} className="border-b border-neutral-700/35 last:border-0">
                          <td className="truncate px-1 py-[2px] font-semibold" title={player?.player}>{player?.player}</td>
                          <td className="px-0.5 text-center font-bold">{dnp ? "DNP" : player?.min}</td>
                          <td className="px-0.5 text-center">{stat(player?.pts)}</td>
                          <td className="px-0.5 text-center">{stat(player?.reb)}</td>
                          <td className="px-0.5 text-center">{stat(player?.ast)}</td>
                          <td className="px-0.5 text-center">{stat(player?.stl)}</td>
                          <td className="px-0.5 text-center">{stat(player?.blk)}</td>
                          <td className="px-0.5 text-center whitespace-nowrap">{stat(player?.fg)}</td>
                          <td className="px-0.5 text-center whitespace-nowrap">{stat(player?.["3p"])}</td>
                          <td className="px-0.5 text-center whitespace-nowrap">{stat(player?.ft)}</td>
                          <td className="px-0.5 text-center">{stat(player?.to)}</td>
                          <td className="px-0.5 text-center">{stat(player?.pf)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  )}

{/* ---------------------------- INJURY ALERT MODAL ---------------------------- */}
{injuryAlertModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[245] bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => setInjuryAlertModal(null)}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-orange-500/40 bg-neutral-950 text-white shadow-[0_0_36px_rgba(0,0,0,0.62)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-600/20 to-red-500/10 px-6 py-5">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300">Controlled Team Alert</div>
          <h2 className="mt-1 text-2xl font-black text-white">Injury Update</h2>
          <p className="mt-1 text-sm font-semibold text-orange-100/80">
            Your rotation has already been auto-rebuilt so injured players cannot start or play minutes.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="space-y-2">
            {(injuryAlertModal.events || []).map((event) => (
              <div key={event.id} className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-bold text-neutral-100">
                {formatInjuryEventLine(event)}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-neutral-200 hover:bg-white/10"
              onClick={() => {
                setInjuryAlertModal(null);
                navigate("/coach-gameplan");
              }}
            >
              Adjust Rotation Manually
            </button>
            <button
              type="button"
              className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-500"
              onClick={() => {
                setInjuryAlertModal(null);
                if (injuryAlertModal.intent) {
                  window.setTimeout(() => resumePendingSimulation(), 0);
                }
              }}
            >
              Keep CPU Auto-Rebuild
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )}

{pendingSimIntent && !simLock && !injuryAlertModal && !tradeDeadlinePromptOpen && !contractExtensionPromptOpen && !allStarPromptOpen && !allStarOpen && (
  <div className="fixed bottom-6 left-1/2 z-[252] w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-orange-400/35 bg-neutral-950/95 p-4 text-white shadow-2xl backdrop-blur">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">Simulation Paused</div>
        <div className="mt-1 text-sm font-bold text-neutral-200">
          {pendingSimIntent.mode === "full_season"
            ? "Resume the full-season simulation from the next unplayed game."
            : `Resume simulation through ${pendingSimIntent.targetDate}.`}
        </div>
      </div>
      <button
        type="button"
        onClick={() => resumePendingSimulation()}
        className="shrink-0 rounded-xl bg-orange-600 px-5 py-3 text-sm font-black hover:bg-orange-500"
      >
        Resume Simulation
      </button>
    </div>
  </div>
)}
{tradeToasts.length > 0 && (
  <div className="pointer-events-none fixed bottom-6 right-6 z-[260] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
    {tradeToasts.map((toast) => (
      <div
        key={toast.id}
        className="rounded-2xl border border-orange-400/35 bg-neutral-950/95 p-4 text-white shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">
            Trade Alert
          </div>
          <div className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">
            {toast.tag}
          </div>
        </div>
        <div className="mt-2 text-sm font-black leading-relaxed text-neutral-100">
          {toast.headline}
        </div>
      </div>
    ))}
  </div>
)}

{contractExtensionPromptOpen && (
  <div className="fixed inset-0 z-[234] flex items-center justify-center bg-black/75 p-4">
    <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-emerald-400/35 bg-neutral-950 text-white shadow-2xl">
      <div className="border-b border-emerald-500/20 bg-gradient-to-r from-emerald-600/20 to-neutral-900 px-6 py-5">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">
          {contractExtensionPromptInfo?.label || "Contract Extension Deadline"}
        </div>
        <h2 className="mt-1 text-2xl font-black text-white">
          {contractExtensionPromptInfo?.title || "Final day to secure long-term extensions"}
        </h2>
      </div>

      <div className="px-6 py-5">
        <p className="text-sm font-semibold leading-6 text-neutral-300">
          CPU teams will complete their {contractExtensionPromptInfo?.type === "veteran" ? "veteran" : "rookie-scale"} extension review today. You can open
          Contract Extensions to negotiate with eligible players, or continue and
          close this extension window for the season.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            disabled={contractExtensionDeadlineBusy}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-neutral-200 hover:bg-white/10 disabled:opacity-50"
            onClick={async () => {
              try {
                await processContractExtensionDeadline({ closeWindow: false, deadlineType: contractExtensionPromptInfo?.type });
                markContractExtensionDeadlineHandled(contractExtensionPromptInfo?.type);
                setContractExtensionPromptOpen(false);
                navigate("/contract-extensions");
              } catch (error) {
                openSimError(error?.message || "Extension deadline processing failed.", "Contract extension error");
              }
            }}
          >
            Open Contract Extensions
          </button>

          <button
            disabled={contractExtensionDeadlineBusy}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
            onClick={async () => {
              try {
                await processContractExtensionDeadline({ closeWindow: true, deadlineType: contractExtensionPromptInfo?.type });
                markContractExtensionDeadlineHandled(contractExtensionPromptInfo?.type);
                setContractExtensionPromptOpen(false);
                window.setTimeout(() => resumePendingSimulation(), 0);
              } catch (error) {
                openSimError(error?.message || "Extension deadline processing failed.", "Contract extension error");
              }
            }}
          >
            {contractExtensionDeadlineBusy ? "Processing…" : "Close Window & Continue"}
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{userTradeDeadlineEnabled && tradeDeadlinePromptOpen && (
  <div className="fixed inset-0 z-[233] flex items-center justify-center bg-black/75 p-4">
    <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-orange-400/35 bg-neutral-950 text-white shadow-2xl">
      <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-600/20 to-neutral-900 px-6 py-5">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">
          Trade Deadline
        </div>
        <h2 className="mt-1 text-2xl font-black text-white">
          Today is the last day for trade offers
        </h2>
      </div>

      <div className="px-6 py-5">
        <p className="text-sm font-semibold leading-6 text-neutral-300">
          The trade deadline is February 4. After this date, new trade offers
          will be locked for the rest of the season. Would you like to make
          offers before continuing?
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-neutral-200 hover:bg-white/10"
            onClick={() => {
              markTradeDeadlinePromptHandled("continue");
              setTradeDeadlinePromptOpen(false);
              window.setTimeout(() => resumePendingSimulation(), 0);
            }}
          >
            Continue Season
          </button>

          <button
            className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-500"
            onClick={() => {
              markTradeDeadlinePromptHandled("trade_center");
              setTradeDeadlinePromptOpen(false);
              navigate("/trades");
            }}
          >
            Make Trade Offers
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{allStarPromptOpen && (
  <div className="fixed inset-0 z-[235] flex items-center justify-center bg-black/75 p-4">
    <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-neutral-900 p-6 text-white shadow-2xl">
      <h2 className="text-2xl font-bold text-orange-400">All-Star Weekend</h2>

      <p className="mt-3 text-sm text-neutral-300">
        It is now All-Star Weekend. Would you like to pause and view the
        All-Star teams?
      </p>

      <div className="mt-6 flex justify-end gap-3">
        <button
          className="rounded-lg bg-neutral-700 px-4 py-2 font-semibold text-white hover:bg-neutral-600"
          onClick={async () => {
            await computeAndSaveAllStarTeams({ openModal: false });
            window.setTimeout(() => resumePendingSimulation(), 0);
          }}
        >
          Not Now
        </button>

        <button
          className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-500"
          onClick={openAllStarTeams}
        >
          View All-Stars
        </button>
      </div>
    </div>
  </div>
)}

<AllStars
  open={allStarOpen}
  data={allStarData}
  onClose={closeAllStarTeams}
  closeLabel={pendingSimIntent ? "Close & Continue Simulation" : "Close"}
/>
    </div>
  
    </PageFade>
  );
}