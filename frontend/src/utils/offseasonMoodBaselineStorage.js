import {
  deleteAppDataFromDB,
  loadAppDataFromDB,
  saveAppDataToDB,
} from "./indexedDbStorage.js";

export const OFFSEASON_MOOD_BASELINE_KEY = "bm_offseason_mood_baseline_v1";

let baselineCache = null;
let initialized = false;
let writeChain = Promise.resolve();
let lastPersistError = null;

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function queueWrite(operation) {
  writeChain = writeChain
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      lastPersistError = error;
      console.warn("[OffseasonMoodBaseline] IndexedDB persistence failed", error);
      return false;
    });
  return writeChain;
}

export async function initializeOffseasonMoodBaselineStorage({ reset = false } = {}) {
  if (initialized && !reset) return getOffseasonMoodBaselineStorageReport();

  if (reset) {
    baselineCache = null;
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(OFFSEASON_MOOD_BASELINE_KEY);
    }
    try {
      await deleteAppDataFromDB(OFFSEASON_MOOD_BASELINE_KEY);
    } catch (error) {
      console.warn("[OffseasonMoodBaseline] reset could not clear IndexedDB", error);
    }
    initialized = true;
    return getOffseasonMoodBaselineStorageReport();
  }

  try {
    baselineCache = await loadAppDataFromDB(OFFSEASON_MOOD_BASELINE_KEY);
  } catch (error) {
    console.warn("[OffseasonMoodBaseline] IndexedDB bootstrap read failed", error);
  }

  if (typeof localStorage !== "undefined") {
    const legacy = safeJSON(localStorage.getItem(OFFSEASON_MOOD_BASELINE_KEY), null);
    if (legacy && typeof legacy === "object") {
      baselineCache = legacy;
      try {
        await saveAppDataToDB(OFFSEASON_MOOD_BASELINE_KEY, legacy);
        localStorage.removeItem(OFFSEASON_MOOD_BASELINE_KEY);
        lastPersistError = null;
      } catch (error) {
        lastPersistError = error;
        console.warn("[OffseasonMoodBaseline] legacy migration failed; keeping localStorage copy", error);
      }
    }
  }

  initialized = true;
  return getOffseasonMoodBaselineStorageReport();
}

export function readOffseasonMoodBaselineSnapshot() {
  return baselineCache;
}

export function writeOffseasonMoodBaselineSnapshot(snapshot) {
  baselineCache = snapshot || null;
  if (!snapshot) {
    queueWrite(() => deleteAppDataFromDB(OFFSEASON_MOOD_BASELINE_KEY));
    return null;
  }

  queueWrite(async () => {
    await saveAppDataToDB(OFFSEASON_MOOD_BASELINE_KEY, snapshot);
    lastPersistError = null;
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(OFFSEASON_MOOD_BASELINE_KEY);
    }
    return true;
  });

  return snapshot;
}

export function clearOffseasonMoodBaselineStorage() {
  baselineCache = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(OFFSEASON_MOOD_BASELINE_KEY);
  }
  queueWrite(() => deleteAppDataFromDB(OFFSEASON_MOOD_BASELINE_KEY));
}

export async function flushOffseasonMoodBaselineStorageWrites() {
  await writeChain.catch(() => {});
}

export async function getOffseasonMoodBaselineStorageReport() {
  let indexedDbReadable = false;
  let indexedDbHasBaseline = false;
  try {
    indexedDbHasBaseline = !!(await loadAppDataFromDB(OFFSEASON_MOOD_BASELINE_KEY));
    indexedDbReadable = true;
  } catch {}

  return {
    initialized,
    storage: "indexedDB",
    cached: !!baselineCache,
    indexedDbHasBaseline,
    indexedDbReadable,
    legacyLocalStoragePresent:
      typeof localStorage !== "undefined" &&
      !!localStorage.getItem(OFFSEASON_MOOD_BASELINE_KEY),
    lastPersistError: lastPersistError ? String(lastPersistError?.message || lastPersistError) : null,
  };
}
