// src/utils/scheduleStorage.js
// Durable regular-season schedule storage.
//
// The schedule is structural data: dates + matchups do not change during a
// season. Per-game `played` state is already authoritative in Results V3, so it
// is deliberately NOT persisted here. This keeps the schedule out of the tiny
// synchronous localStorage quota and avoids rewriting ~1,230 games every time
// simulation advances.

import {
  deleteAppDataFromDB,
  loadAppDataFromDB,
  saveAppDataToDB,
} from "./indexedDbStorage.js";

export const REGULAR_SCHEDULE_STORAGE_KEY = "bm_schedule_v3";
const SCHEDULE_DB_KEY = "bm_schedule_v3_indexeddb_v1";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";

let runtimeScheduleCache = null;
let persistedStructureFingerprint = "";
let scheduleStorageInitialized = false;
let scheduleWriteChain = Promise.resolve();
let lastPersistError = null;

function safeJson(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function slugifyTeamId(value) {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function resolveTeamLogo(team = {}) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

function getAllTeams(leagueOrTeams = []) {
  if (Array.isArray(leagueOrTeams)) return leagueOrTeams.filter(Boolean);
  if (Array.isArray(leagueOrTeams?.teams)) return leagueOrTeams.teams.filter(Boolean);
  return Object.entries(leagueOrTeams?.conferences || {}).flatMap(([conference, teams]) =>
    (teams || []).filter(Boolean).map((team) => ({
      ...team,
      conference: team?.conference || team?.conf || conference,
    }))
  );
}

function readPlayedResultIds() {
  if (typeof localStorage === "undefined") return new Set();
  const ids = safeJson(localStorage.getItem(RESULT_V3_INDEX_KEY), []);
  return new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String));
}

function hydratePlayedFlags(schedule = {}) {
  const playedIds = readPlayedResultIds();
  const out = {};

  for (const [date, games] of Object.entries(schedule || {})) {
    out[date] = (Array.isArray(games) ? games : []).map((game) => ({
      ...game,
      date: game?.date || date,
      played: Boolean(game?.id && playedIds.has(String(game.id))),
    }));
  }

  return out;
}

export function compactScheduleForStorage(schedule = {}) {
  const out = {};

  for (const [date, games] of Object.entries(schedule || {})) {
    out[date] = (Array.isArray(games) ? games : [])
      .filter((game) => game?.id && game?.homeId && game?.awayId)
      .map((game) => ({
        id: String(game.id),
        date: game?.date || date,
        homeId: String(game.homeId),
        awayId: String(game.awayId),
        home: game?.home || "",
        away: game?.away || "",
      }));
  }

  return out;
}

export function getScheduleStructureFingerprint(schedule = {}) {
  let hash = 2166136261;
  let games = 0;
  const dates = Object.keys(schedule || {}).sort();

  const feed = (value) => {
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };

  for (const date of dates) {
    feed(date);
    const rows = Array.isArray(schedule?.[date]) ? schedule[date] : [];
    for (const game of rows) {
      if (!game?.id) continue;
      games += 1;
      feed(game.id);
      feed(game.homeId);
      feed(game.awayId);
    }
  }

  return `${dates.length}:${games}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function hydrateScheduleTeamMetadata(schedule = {}, leagueOrTeams = []) {
  const teams = getAllTeams(leagueOrTeams);
  const byId = new Map();
  const byName = new Map();

  for (const team of teams) {
    const name = team?.name || team?.teamName || "";
    if (!name) continue;
    const id = slugifyTeamId(name);
    const division = team?.division || team?.divisionName || "";
    const conference = team?.conference || team?.conf || "";
    const meta = {
      id,
      name,
      division,
      conference,
      logo: resolveTeamLogo(team),
    };
    byId.set(id, meta);
    byName.set(name, meta);
  }

  const out = {};
  for (const [date, games] of Object.entries(schedule || {})) {
    out[date] = (Array.isArray(games) ? games : []).map((game) => {
      const homeMeta = byId.get(String(game?.homeId || "")) || byName.get(game?.home) || null;
      const awayMeta = byId.get(String(game?.awayId || "")) || byName.get(game?.away) || null;
      return {
        ...game,
        date: game?.date || date,
        home: game?.home || homeMeta?.name || "",
        away: game?.away || awayMeta?.name || "",
        homeLogo: game?.homeLogo || homeMeta?.logo || "",
        awayLogo: game?.awayLogo || awayMeta?.logo || "",
        homeTeamObj: game?.homeTeamObj || homeMeta || null,
        awayTeamObj: game?.awayTeamObj || awayMeta || null,
        confHome: game?.confHome || homeMeta?.conference || "",
        confAway: game?.confAway || awayMeta?.conference || "",
        divisionHome: game?.divisionHome || homeMeta?.division || "",
        divisionAway: game?.divisionAway || awayMeta?.division || "",
      };
    });
  }
  return out;
}

export function readScheduleFromStorage() {
  if (runtimeScheduleCache && typeof runtimeScheduleCache === "object") {
    return runtimeScheduleCache;
  }

  // Legacy compatibility before async bootstrap completes. This path disappears
  // after a successful migration because the old localStorage key is removed.
  try {
    const legacy = safeJson(localStorage.getItem(REGULAR_SCHEDULE_STORAGE_KEY), null);
    if (legacy && typeof legacy === "object") {
      runtimeScheduleCache = hydratePlayedFlags(legacy);
      return runtimeScheduleCache;
    }
  } catch {}

  return {};
}

export function cacheScheduleForRuntime(schedule = {}) {
  runtimeScheduleCache = schedule && typeof schedule === "object" ? schedule : {};
  return runtimeScheduleCache;
}

function enqueueScheduleOperation(operation) {
  scheduleWriteChain = scheduleWriteChain
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      lastPersistError = error;
      console.warn("[ScheduleStorage] IndexedDB operation failed", error);
      return false;
    });
  return scheduleWriteChain;
}

export function persistScheduleStructure(schedule = {}) {
  const compact = compactScheduleForStorage(schedule);
  const fingerprint = getScheduleStructureFingerprint(compact);

  // Simulation updates only `played`. If the structural fingerprint did not
  // change, there is nothing durable to rewrite.
  if (fingerprint && fingerprint === persistedStructureFingerprint) {
    return scheduleWriteChain;
  }

  return enqueueScheduleOperation(async () => {
    try {
      await saveAppDataToDB(SCHEDULE_DB_KEY, compact);
      persistedStructureFingerprint = fingerprint;
      lastPersistError = null;
      try {
        localStorage.removeItem(REGULAR_SCHEDULE_STORAGE_KEY);
      } catch {}
      return true;
    } catch (error) {
      // Emergency durability only. This compact fallback is dramatically
      // smaller than the legacy schedule and is never used on the normal sim
      // path; the next successful bootstrap migrates it into IndexedDB.
      try {
        localStorage.setItem(REGULAR_SCHEDULE_STORAGE_KEY, JSON.stringify(compact));
      } catch {}
      throw error;
    }
  });
}

export function clearScheduleStorage() {
  runtimeScheduleCache = {};
  persistedStructureFingerprint = "";
  try {
    localStorage.removeItem(REGULAR_SCHEDULE_STORAGE_KEY);
  } catch {}
  return enqueueScheduleOperation(async () => {
    await deleteAppDataFromDB(SCHEDULE_DB_KEY);
    lastPersistError = null;
    return true;
  });
}

export async function flushScheduleStorageWrites() {
  await scheduleWriteChain.catch(() => {});
}

export async function initializeScheduleStorage({ reset = false } = {}) {
  if (scheduleStorageInitialized && !reset) return getScheduleStorageReport();

  if (reset) {
    runtimeScheduleCache = {};
    persistedStructureFingerprint = "";
    try {
      localStorage.removeItem(REGULAR_SCHEDULE_STORAGE_KEY);
    } catch {}
    try {
      await deleteAppDataFromDB(SCHEDULE_DB_KEY);
    } catch (error) {
      console.warn("[ScheduleStorage] reset could not clear IndexedDB schedule", error);
    }
    scheduleStorageInitialized = true;
    return getScheduleStorageReport();
  }

  let legacy = null;
  try {
    legacy = safeJson(localStorage.getItem(REGULAR_SCHEDULE_STORAGE_KEY), null);
  } catch {}

  let dbSchedule = null;
  try {
    dbSchedule = await loadAppDataFromDB(SCHEDULE_DB_KEY);
  } catch (error) {
    console.warn("[ScheduleStorage] IndexedDB bootstrap read failed", error);
  }

  // A still-present legacy key is from the pre-migration code and therefore
  // wins once. Only remove it after its structural copy is safely in IndexedDB.
  const source = legacy && typeof legacy === "object" ? legacy : dbSchedule;
  const compact = compactScheduleForStorage(source || {});
  runtimeScheduleCache = hydratePlayedFlags(compact);
  persistedStructureFingerprint = dbSchedule
    ? getScheduleStructureFingerprint(compactScheduleForStorage(dbSchedule))
    : "";

  if (legacy && typeof legacy === "object") {
    try {
      await saveAppDataToDB(SCHEDULE_DB_KEY, compact);
      persistedStructureFingerprint = getScheduleStructureFingerprint(compact);
      localStorage.removeItem(REGULAR_SCHEDULE_STORAGE_KEY);
      lastPersistError = null;
    } catch (error) {
      lastPersistError = error;
      console.warn(
        "[ScheduleStorage] legacy migration could not finish; keeping localStorage source intact",
        error
      );
      // Keep the old key when migration fails so an existing save cannot be lost.
    }
  }

  scheduleStorageInitialized = true;

  try {
    if (typeof window !== "undefined") {
      window.bmScheduleStorage = {
        report: getScheduleStorageReport,
        flush: flushScheduleStorageWrites,
      };
      window.bmStorageAudit = getLocalStorageUsageReport;
    }
  } catch {}

  return getScheduleStorageReport();
}

export function getLocalStorageUsageReport() {
  const rows = [];
  let totalBytes = 0;

  if (typeof localStorage === "undefined") {
    return { totalBytes: 0, totalMiB: 0, rows: [] };
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    const value = localStorage.getItem(key) || "";
    // Browser localStorage strings are UTF-16 in memory. This is an estimate,
    // useful for ranking quota consumers rather than claiming exact disk bytes.
    const bytes = (key.length + value.length) * 2;
    totalBytes += bytes;
    rows.push({ key, bytes, kib: Number((bytes / 1024).toFixed(1)) });
  }

  rows.sort((a, b) => b.bytes - a.bytes);
  return {
    totalBytes,
    totalMiB: Number((totalBytes / 1024 / 1024).toFixed(3)),
    rows,
  };
}

export async function getScheduleStorageReport() {
  let dbSchedule = null;
  let indexedDbReadable = false;
  try {
    dbSchedule = await loadAppDataFromDB(SCHEDULE_DB_KEY);
    indexedDbReadable = true;
  } catch {}

  const runtimeCompact = compactScheduleForStorage(runtimeScheduleCache || {});
  const dbCompact = compactScheduleForStorage(dbSchedule || {});
  const encodeBytes = (value) => {
    try {
      return new Blob([JSON.stringify(value || {})]).size;
    } catch {
      return 0;
    }
  };

  return {
    initialized: scheduleStorageInitialized,
    storage: "indexedDB",
    runtimeFingerprint: getScheduleStructureFingerprint(runtimeCompact),
    persistedFingerprint: persistedStructureFingerprint,
    runtimeGames: Object.values(runtimeCompact).reduce((sum, games) => sum + (games?.length || 0), 0),
    indexedDbGames: Object.values(dbCompact).reduce((sum, games) => sum + (games?.length || 0), 0),
    indexedDbReadable,
    runtimeBytes: encodeBytes(runtimeCompact),
    indexedDbBytes: encodeBytes(dbCompact),
    localStorageMirrorPresent:
      typeof localStorage !== "undefined" &&
      localStorage.getItem(REGULAR_SCHEDULE_STORAGE_KEY) !== null,
    pendingWrite: scheduleWriteChain instanceof Promise,
    lastPersistError: lastPersistError ? String(lastPersistError?.message || lastPersistError) : null,
  };
}
