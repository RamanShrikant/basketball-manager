import {
  deleteAppDataByPrefixFromDB,
  deleteAppDataFromDB,
  loadAppDataEntriesByPrefixFromDB,
  loadAppDataFromDB,
  saveAppDataToDB,
} from "./indexedDbStorage.js";

export const CUSTOM_DRAFT_CLASS_KEY = "bm_custom_draft_class_v1";
export const CUSTOM_DRAFT_CLASS_PREFIX = "bm_custom_draft_class_";
export const CUSTOM_DRAFT_CLASSES_INDEX_KEY = "bm_custom_draft_classes_v1";

const customDraftClassCache = new Map();
let customDraftClassIndexCache = {};
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
      console.warn("[CustomDraftStorage] IndexedDB persistence failed", error);
      return false;
    });
  return writeChain;
}

function classKeyForYear(seasonYear) {
  return `${CUSTOM_DRAFT_CLASS_PREFIX}${Number(seasonYear || 2026)}`;
}

function isYearClassKey(key) {
  return new RegExp(`^${CUSTOM_DRAFT_CLASS_PREFIX}\\d+$`).test(String(key || ""));
}

function deriveSummaryIndexFromClasses(classes = {}) {
  const next = {};
  for (const [year, value] of Object.entries(classes || {})) {
    const seasonYear = Number(year);
    if (!Number.isFinite(seasonYear)) continue;
    const rows = Array.isArray(value)
      ? value
      : Array.isArray(value?.draftClass)
      ? value.draftClass
      : [];
    next[String(seasonYear)] = {
      seasonYear,
      count: rows.length || Number(value?.count || 0),
      fileName: value?.fileName || value?.sourceFile || null,
      importedAt: value?.importedAt || null,
    };
  }
  return next;
}

export async function initializeCustomDraftClassStorage({ reset = false } = {}) {
  if (initialized && !reset) return getCustomDraftClassStorageReport();

  if (reset) {
    customDraftClassCache.clear();
    customDraftClassIndexCache = {};
    if (typeof localStorage !== "undefined") {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (
          key === CUSTOM_DRAFT_CLASS_KEY ||
          key === CUSTOM_DRAFT_CLASSES_INDEX_KEY ||
          key?.startsWith(CUSTOM_DRAFT_CLASS_PREFIX)
        ) {
          keys.push(key);
        }
      }
      for (const key of keys) localStorage.removeItem(key);
    }
    try {
      await deleteAppDataFromDB(CUSTOM_DRAFT_CLASS_KEY);
      await deleteAppDataFromDB(CUSTOM_DRAFT_CLASSES_INDEX_KEY);
      await deleteAppDataByPrefixFromDB(CUSTOM_DRAFT_CLASS_PREFIX);
    } catch (error) {
      console.warn("[CustomDraftStorage] reset could not clear IndexedDB", error);
    }
    initialized = true;
    return getCustomDraftClassStorageReport();
  }

  try {
    const [defaultPayload, indexPayload, rows] = await Promise.all([
      loadAppDataFromDB(CUSTOM_DRAFT_CLASS_KEY),
      loadAppDataFromDB(CUSTOM_DRAFT_CLASSES_INDEX_KEY),
      loadAppDataEntriesByPrefixFromDB(CUSTOM_DRAFT_CLASS_PREFIX),
    ]);
    if (defaultPayload) customDraftClassCache.set(CUSTOM_DRAFT_CLASS_KEY, defaultPayload);
    if (indexPayload && typeof indexPayload === "object") customDraftClassIndexCache = indexPayload;
    for (const row of rows || []) {
      if (row?.key && row?.value) customDraftClassCache.set(String(row.key), row.value);
    }
  } catch (error) {
    console.warn("[CustomDraftStorage] IndexedDB bootstrap read failed", error);
  }

  if (typeof localStorage !== "undefined") {
    // Migrate the legacy aggregate first. Older LeagueEditor builds stored full
    // draft-class rows inside this index key, so fan those rows out into the
    // per-year IndexedDB records and keep only a lightweight summary index.
    const legacyIndex = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY), null);
    if (legacyIndex && typeof legacyIndex === "object") {
      const summary = deriveSummaryIndexFromClasses(legacyIndex);
      try {
        for (const [year, value] of Object.entries(legacyIndex)) {
          const seasonYear = Number(year);
          if (!Number.isFinite(seasonYear)) continue;
          const rows = Array.isArray(value)
            ? value
            : Array.isArray(value?.draftClass)
            ? value.draftClass
            : null;
          if (!rows) continue;
          const payload = value?.draftClass
            ? value
            : { seasonYear, draftClassYear: seasonYear, classType: "custom", draftClass: rows };
          await saveAppDataToDB(classKeyForYear(seasonYear), payload);
          customDraftClassCache.set(classKeyForYear(seasonYear), payload);
        }
        customDraftClassIndexCache = Object.keys(summary).length ? summary : legacyIndex;
        await saveAppDataToDB(CUSTOM_DRAFT_CLASSES_INDEX_KEY, customDraftClassIndexCache);
        localStorage.removeItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY);
        lastPersistError = null;
      } catch (error) {
        lastPersistError = error;
        console.warn("[CustomDraftStorage] legacy aggregate migration failed; keeping localStorage copy", error);
      }
    }

    const legacyKeys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === CUSTOM_DRAFT_CLASS_KEY || key?.startsWith(CUSTOM_DRAFT_CLASS_PREFIX)) {
        legacyKeys.push(key);
      }
    }
    for (const key of legacyKeys) {
      const value = safeJSON(localStorage.getItem(key), null);
      if (!value) continue;
      try {
        await saveAppDataToDB(key, value);
        customDraftClassCache.set(key, value);
        localStorage.removeItem(key);
        lastPersistError = null;
      } catch (error) {
        lastPersistError = error;
        console.warn("[CustomDraftStorage] legacy class migration failed; keeping localStorage copy", key, error);
      }
    }
  }

  // Repair a missing/old lightweight index from the actual per-year class
  // records. This also covers saves that only had bm_custom_draft_class_<year>
  // keys and never wrote the aggregate vault.
  const repairedIndex = { ...(customDraftClassIndexCache || {}) };
  let indexChanged = false;
  for (const [key, payload] of customDraftClassCache.entries()) {
    if (!isYearClassKey(key)) continue;
    const seasonYear = Number(String(key).slice(CUSTOM_DRAFT_CLASS_PREFIX.length));
    if (!Number.isFinite(seasonYear)) continue;
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.draftClass)
      ? payload.draftClass
      : [];
    const yearKey = String(seasonYear);
    if (!repairedIndex[yearKey] || Number(repairedIndex[yearKey]?.count || 0) !== rows.length) {
      repairedIndex[yearKey] = {
        seasonYear,
        count: rows.length,
        fileName: repairedIndex[yearKey]?.fileName || payload?.fileName || payload?.sourceFile || null,
        importedAt: repairedIndex[yearKey]?.importedAt || payload?.importedAt || null,
      };
      indexChanged = true;
    }
  }
  if (indexChanged) {
    customDraftClassIndexCache = repairedIndex;
    try {
      await saveAppDataToDB(CUSTOM_DRAFT_CLASSES_INDEX_KEY, repairedIndex);
      if (typeof localStorage !== "undefined") localStorage.removeItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY);
    } catch (error) {
      lastPersistError = error;
      console.warn("[CustomDraftStorage] index repair persistence failed", error);
    }
  }

  initialized = true;
  return getCustomDraftClassStorageReport();
}

export function readCustomDraftClassForYear(seasonYear) {
  return customDraftClassCache.get(classKeyForYear(seasonYear)) || null;
}

export function readDefaultCustomDraftClass() {
  return customDraftClassCache.get(CUSTOM_DRAFT_CLASS_KEY) || null;
}

export function writeCustomDraftClassForYear(seasonYear, payload) {
  const key = classKeyForYear(seasonYear);
  if (!payload) {
    customDraftClassCache.delete(key);
    queueWrite(() => deleteAppDataFromDB(key));
    return null;
  }
  customDraftClassCache.set(key, payload);
  queueWrite(async () => {
    await saveAppDataToDB(key, payload);
    lastPersistError = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    return true;
  });
  return payload;
}


export function deleteCustomDraftClassForYear(seasonYear) {
  const key = classKeyForYear(seasonYear);
  customDraftClassCache.delete(key);
  queueWrite(async () => {
    await deleteAppDataFromDB(key);
    lastPersistError = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    return true;
  });
}

export function writeDefaultCustomDraftClass(payload) {
  if (!payload) {
    customDraftClassCache.delete(CUSTOM_DRAFT_CLASS_KEY);
    queueWrite(() => deleteAppDataFromDB(CUSTOM_DRAFT_CLASS_KEY));
    return null;
  }
  customDraftClassCache.set(CUSTOM_DRAFT_CLASS_KEY, payload);
  queueWrite(async () => {
    await saveAppDataToDB(CUSTOM_DRAFT_CLASS_KEY, payload);
    lastPersistError = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(CUSTOM_DRAFT_CLASS_KEY);
    return true;
  });
  return payload;
}

export function readCustomDraftClassesIndex() {
  return customDraftClassIndexCache && typeof customDraftClassIndexCache === "object"
    ? customDraftClassIndexCache
    : {};
}

export function writeCustomDraftClassesIndex(nextIndex = {}) {
  customDraftClassIndexCache = nextIndex && typeof nextIndex === "object" ? nextIndex : {};
  queueWrite(async () => {
    await saveAppDataToDB(CUSTOM_DRAFT_CLASSES_INDEX_KEY, customDraftClassIndexCache);
    lastPersistError = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY);
    return true;
  });
  return customDraftClassIndexCache;
}

export function replaceCustomDraftClasses(classes = {}) {
  const nextClasses = classes && typeof classes === "object" ? classes : {};
  const nextKeys = new Set();
  for (const [year, rows] of Object.entries(nextClasses)) {
    const seasonYear = Number(year);
    if (!Number.isFinite(seasonYear)) continue;
    const payload = Array.isArray(rows)
      ? { seasonYear, draftClassYear: seasonYear, classType: "custom", draftClass: rows }
      : rows;
    const key = classKeyForYear(seasonYear);
    nextKeys.add(key);
    customDraftClassCache.set(key, payload);
  }

  for (const key of [...customDraftClassCache.keys()]) {
    if (isYearClassKey(key) && !nextKeys.has(key)) {
      customDraftClassCache.delete(key);
    }
  }

  const summary = deriveSummaryIndexFromClasses(nextClasses);
  customDraftClassIndexCache = summary;

  queueWrite(async () => {
    const existing = await loadAppDataEntriesByPrefixFromDB(CUSTOM_DRAFT_CLASS_PREFIX);
    for (const row of existing || []) {
      if (!nextKeys.has(String(row.key))) await deleteAppDataFromDB(row.key);
    }
    for (const key of nextKeys) {
      await saveAppDataToDB(key, customDraftClassCache.get(key));
    }
    await saveAppDataToDB(CUSTOM_DRAFT_CLASSES_INDEX_KEY, summary);
    lastPersistError = null;
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY);
      for (const key of nextKeys) localStorage.removeItem(key);
    }
    return true;
  });

  return nextClasses;
}

export async function flushCustomDraftClassStorageWrites() {
  await writeChain.catch(() => {});
}

export async function getCustomDraftClassStorageReport() {
  let indexedDbReadable = false;
  let dbRows = [];
  try {
    dbRows = await loadAppDataEntriesByPrefixFromDB(CUSTOM_DRAFT_CLASS_PREFIX);
    indexedDbReadable = true;
  } catch {}

  const legacyKeys = [];
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        key === CUSTOM_DRAFT_CLASS_KEY ||
        key === CUSTOM_DRAFT_CLASSES_INDEX_KEY ||
        key?.startsWith(CUSTOM_DRAFT_CLASS_PREFIX)
      ) legacyKeys.push(key);
    }
  }

  return {
    initialized,
    storage: "indexedDB",
    cachedClasses: [...customDraftClassCache.keys()].filter(isYearClassKey).length,
    indexedDbClasses: dbRows.length,
    indexedDbReadable,
    legacyLocalStorageKeys: legacyKeys,
    lastPersistError: lastPersistError ? String(lastPersistError?.message || lastPersistError) : null,
  };
}
