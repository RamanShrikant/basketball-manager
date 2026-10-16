import {
  exportBasketballManagerRuntimeSnapshot,
  replaceBasketballManagerRuntimeSnapshot,
} from "../utils/indexedDbStorage.js";
import {
  clearLeagueDataFromIndexedDB,
  flushLeagueDataWrites,
  saveLeagueData,
} from "../utils/leagueStorage.js";
import { flushCpuTradeLeagueSaves } from "../utils/cpuTradeSaveQueue.js";
import {
  flushScheduleStorageWrites,
  initializeScheduleStorage,
} from "../utils/scheduleStorage.js";
import {
  flushSeasonStatsArchiveStorageWrites,
  initializeSeasonStatsArchiveStorage,
} from "../utils/seasonStatsArchive.js";
import {
  flushOffseasonMoodBaselineStorageWrites,
  initializeOffseasonMoodBaselineStorage,
} from "../utils/offseasonMoodBaselineStorage.js";
import {
  flushTradeDeskStorageWrites,
  initializeTradeDeskStorage,
} from "../utils/tradeDeskFeed.js";
import {
  flushCustomDraftClassStorageWrites,
  initializeCustomDraftClassStorage,
} from "../utils/customDraftClassStorage.js";
import {
  flushUpcomingDraftClassStorageWrites,
  initializeUpcomingDraftClassStorage,
} from "../utils/upcomingDraftClass.js";
import {
  captureLeagueLocalStorage,
  captureLeagueSessionStorage,
  clearLeagueLocalStorage,
  clearLeagueSessionStorage,
  restoreLeagueLocalStorage,
  restoreLeagueSessionStorage,
} from "./saveStorageRegistry.js";

export const ACTIVE_RUNTIME_SNAPSHOT_VERSION = 2;

function leagueHasTeams(leagueData = null) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.length > 0;
  if (leagueData?.conferences) return Object.values(leagueData.conferences).flat().length > 0;
  return false;
}

export async function flushAllLeagueRuntimeWrites() {
  // CPU trade/injury persistence can enqueue full-league or lightweight sidecar
  // writes. Drain that queue first, then wait for every full league write before
  // snapshotting any other runtime store.
  await flushCpuTradeLeagueSaves();
  await flushLeagueDataWrites();

  const settled = await Promise.allSettled([
    flushScheduleStorageWrites(),
    flushSeasonStatsArchiveStorageWrites(),
    flushOffseasonMoodBaselineStorageWrites(),
    flushTradeDeskStorageWrites(),
    flushCustomDraftClassStorageWrites(),
    flushUpcomingDraftClassStorageWrites(),
  ]);

  const failure = settled.find((row) => row.status === "rejected");
  if (failure) throw failure.reason || new Error("A league runtime write could not be flushed.");

  // A storage flush may itself have triggered a league save through a fallback.
  await flushLeagueDataWrites();
}

export async function captureActiveLeagueRuntime({ leagueData } = {}) {
  await flushAllLeagueRuntimeWrites();

  // Fold the latest injury/CPU-trade sidecars into the canonical full league
  // record before the save slot takes its leagueData snapshot.
  const persistedLeagueData = leagueHasTeams(leagueData)
    ? await saveLeagueData(leagueData, { source: "saveManager.captureActiveLeagueRuntime" })
    : leagueData;

  await flushAllLeagueRuntimeWrites();

  return {
    leagueData: persistedLeagueData,
    runtime: {
      version: ACTIVE_RUNTIME_SNAPSHOT_VERSION,
      capturedAt: Date.now(),
      localStorage: captureLeagueLocalStorage(),
      sessionStorage: captureLeagueSessionStorage(),
      indexedDb: await exportBasketballManagerRuntimeSnapshot(),
    },
  };
}

async function resetRuntimeModuleCachesForFreshLeague() {
  // These reset paths are deliberately called only while creating/deleting a
  // league. Restore/Continue uses a hard page reload after hydrating storage,
  // which naturally rebuilds every module cache without deleting restored data.
  const settled = await Promise.allSettled([
    initializeScheduleStorage({ reset: true }),
    initializeSeasonStatsArchiveStorage({ reset: true }),
    initializeOffseasonMoodBaselineStorage({ reset: true }),
    initializeTradeDeskStorage({ reset: true }),
    initializeCustomDraftClassStorage({ reset: true }),
    initializeUpcomingDraftClassStorage({ reset: true }),
  ]);
  const failure = settled.find((row) => row.status === "rejected");
  if (failure) throw failure.reason || new Error("A league runtime cache could not be reset.");
}

export async function clearActiveLeagueRuntime({ resetCaches = true } = {}) {
  // Never destroy the active universe while one of its writes is still in
  // flight. Callers can surface the error and keep the current game open.
  await flushAllLeagueRuntimeWrites();
  clearLeagueLocalStorage();
  clearLeagueSessionStorage();
  await Promise.all([
    replaceBasketballManagerRuntimeSnapshot(null),
    clearLeagueDataFromIndexedDB(),
  ]);
  if (resetCaches) await resetRuntimeModuleCachesForFreshLeague();
}

export async function restoreLeagueRuntime({ runtime, leagueData, selectedTeamName = "" } = {}) {
  // Never merge two universes. The active runtime is emptied before the target
  // bundle is hydrated.
  clearLeagueLocalStorage();
  clearLeagueSessionStorage();
  await Promise.all([
    replaceBasketballManagerRuntimeSnapshot(runtime?.indexedDb || null),
    clearLeagueDataFromIndexedDB(),
  ]);

  restoreLeagueLocalStorage(runtime?.localStorage || {});
  restoreLeagueSessionStorage(runtime?.sessionStorage || {});

  if (leagueHasTeams(leagueData)) {
    await saveLeagueData(leagueData, { source: "saveManager.restoreLeagueRuntime" });
  }

  try {
    if (selectedTeamName) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeamName));
    else localStorage.removeItem("selectedTeam");
  } catch {}

  return {
    runtimeVersion: Number(runtime?.version || 0),
    hasRuntimeSnapshot: Boolean(runtime && typeof runtime === "object"),
  };
}
