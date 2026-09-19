import { saveLeagueData } from "../utils/leagueStorage.js";

export const CURRENT_LEAGUE_SAVE_SCHEMA_VERSION = 1;

const DB_NAME = "basketball_manager_local_save_slots_v1";
const DB_VERSION = 1;
const STORE_NAME = "leagueSaves";
const ACTIVE_SAVE_KEY = "bm_active_league_save_id_v1";

function hasIndexedDB() {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch {
    return false;
  }
}

function createId(prefix = "league") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  if (value == null) return value;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {}
  return JSON.parse(JSON.stringify(value));
}

function safeDate(value = null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizeLeagueName(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function assertUniqueLeagueName(leagueName, { ignoreSaveId = "" } = {}) {
  const normalized = normalizeLeagueName(leagueName);
  if (!normalized) throw new Error("League name is required.");

  const existingSaves = await listLeagueSaves();
  const duplicate = existingSaves.find((save) => {
    if (!save?.saveId) return false;
    if (ignoreSaveId && String(save.saveId) === String(ignoreSaveId)) return false;
    return normalizeLeagueName(save.leagueName) === normalized;
  });

  if (duplicate) {
    throw new Error("A league with this name already exists. Choose a different name.");
  }
}

function getTeams(leagueData = null) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function leagueHasTeams(leagueData = null) {
  return getTeams(leagueData).length > 0;
}

function resolveTeamName(leagueData = null, selectedTeamName = "") {
  const raw = String(selectedTeamName || "").trim();
  if (raw) return raw;
  const saved = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("selectedTeam") || "null");
      return typeof parsed === "string" ? parsed : parsed?.name || "";
    } catch {
      return "";
    }
  })();
  if (saved) return saved;
  return getTeams(leagueData)?.[0]?.name || "";
}

function resolveSeasonLabel(leagueData = null) {
  const seasonYear = Number(
    leagueData?.seasonYear || leagueData?.currentSeasonYear || leagueData?.seasonStartYear || leagueData?.year || 0
  );
  if (Number.isFinite(seasonYear) && seasonYear > 0) return `Season ${seasonYear}-${String(seasonYear + 1).slice(-2)}`;
  return "Season not started";
}

function buildMetadata({ saveId, leagueName, leagueData, selectedTeamName, createdAt, updatedAt, schemaVersion } = {}) {
  const now = new Date().toISOString();
  const teamName = resolveTeamName(leagueData, selectedTeamName);
  return {
    saveId: saveId || createId("save"),
    leagueName: String(leagueName || "Untitled League").trim() || "Untitled League",
    createdAt: safeDate(createdAt || now),
    updatedAt: safeDate(updatedAt || now),
    schemaVersion: Number(schemaVersion || CURRENT_LEAGUE_SAVE_SCHEMA_VERSION),
    appVersion: "local-save-slots-v1",
    controlledTeamName: teamName || "No team selected",
    seasonLabel: resolveSeasonLabel(leagueData),
    teamCount: getTeams(leagueData).length,
  };
}

function buildSaveRecord({ saveId, leagueName, leagueData, selectedTeamName, createdAt, updatedAt, source = "unknown" } = {}) {
  const metadata = buildMetadata({ saveId, leagueName, leagueData, selectedTeamName, createdAt, updatedAt });
  return {
    ...metadata,
    snapshot: {
      leagueData: clone(leagueData),
      selectedTeamName: resolveTeamName(leagueData, selectedTeamName),
      savedRoute: typeof window !== "undefined" ? window.location?.pathname || "" : "",
      savedAt: metadata.updatedAt,
      source,
    },
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "saveId" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("leagueName", "leagueName", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local save slots."));
    request.onblocked = () => console.warn("[leagueSaves] Database upgrade is blocked by another tab.");
  });
}

function runTransaction(mode, callback) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      let tx;
      let store;
      let request = null;

      try {
        tx = db.transaction(STORE_NAME, mode);
        store = tx.objectStore(STORE_NAME);
        request = callback(store);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }

      if (request) {
        request.onerror = () => reject(request.error || new Error("Local save request failed."));
      }

      tx.oncomplete = () => {
        const result = request?.result ?? null;
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("Local save transaction failed."));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("Local save transaction aborted."));
      };
    });
  });
}

export function getActiveLeagueSaveId() {
  if (!hasLocalStorage()) return "";
  return String(localStorage.getItem(ACTIVE_SAVE_KEY) || "").trim();
}

export function setActiveLeagueSaveId(saveId = "") {
  if (!hasLocalStorage()) return;
  const next = String(saveId || "").trim();
  if (next) localStorage.setItem(ACTIVE_SAVE_KEY, next);
  else localStorage.removeItem(ACTIVE_SAVE_KEY);
}

export function clearActiveLeagueSaveId() {
  setActiveLeagueSaveId("");
}

export function migrateLeagueSave(record = null) {
  if (!record || typeof record !== "object") return null;
  const snapshot = record.snapshot && typeof record.snapshot === "object" ? record.snapshot : {};
  const leagueData = snapshot.leagueData || record.leagueData || null;
  const migrated = {
    ...record,
    saveId: record.saveId || record.id || createId("save"),
    leagueName: String(record.leagueName || record.name || "Untitled League").trim() || "Untitled League",
    createdAt: safeDate(record.createdAt || record.updatedAt),
    updatedAt: safeDate(record.updatedAt || record.createdAt),
    schemaVersion: Number(record.schemaVersion || 1),
    appVersion: record.appVersion || "local-save-slots-v1",
    snapshot: {
      ...snapshot,
      leagueData,
      selectedTeamName: resolveTeamName(leagueData, snapshot.selectedTeamName || record.controlledTeamName),
      savedAt: snapshot.savedAt || record.updatedAt || new Date().toISOString(),
    },
  };

  const metadata = buildMetadata({
    saveId: migrated.saveId,
    leagueName: migrated.leagueName,
    leagueData: migrated.snapshot.leagueData,
    selectedTeamName: migrated.snapshot.selectedTeamName,
    createdAt: migrated.createdAt,
    updatedAt: migrated.updatedAt,
    schemaVersion: migrated.schemaVersion,
  });

  return {
    ...migrated,
    ...metadata,
    schemaVersion: CURRENT_LEAGUE_SAVE_SCHEMA_VERSION,
  };
}

export async function listLeagueSaves() {
  const records = await runTransaction("readonly", (store) => store.getAll());
  return (records || [])
    .map(migrateLeagueSave)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

export async function getLeagueSave(saveId) {
  const id = String(saveId || "").trim();
  if (!id) return null;
  return migrateLeagueSave(await runTransaction("readonly", (store) => store.get(id)));
}

export async function upsertLeagueSave(record) {
  const migrated = migrateLeagueSave(record);
  if (!migrated) throw new Error("Cannot save an empty league slot.");
  await runTransaction("readwrite", (store) => store.put(migrated));
  return migrated;
}

export async function createLeagueSave({ leagueName, leagueData, selectedTeamName, activate = true, source = "create" } = {}) {
  if (!leagueHasTeams(leagueData)) throw new Error("Cannot create a save before a roster is loaded.");
  const cleanLeagueName = String(leagueName || "").trim() || "Untitled League";
  await assertUniqueLeagueName(cleanLeagueName);
  const now = new Date().toISOString();
  const record = buildSaveRecord({ leagueName: cleanLeagueName, leagueData, selectedTeamName, createdAt: now, updatedAt: now, source });
  await upsertLeagueSave(record);
  if (activate) setActiveLeagueSaveId(record.saveId);
  return record;
}

export async function updateLeagueSaveSnapshot(saveId, { leagueName, leagueData, selectedTeamName, source = "update" } = {}) {
  const id = String(saveId || "").trim();
  if (!id) return null;
  if (!leagueHasTeams(leagueData)) return null;

  const existing = (await getLeagueSave(id)) || {};
  const now = new Date().toISOString();
  const record = buildSaveRecord({
    saveId: id,
    leagueName: leagueName || existing.leagueName || "Untitled League",
    leagueData,
    selectedTeamName,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    source,
  });
  await upsertLeagueSave(record);
  return record;
}

export async function updateActiveLeagueSaveSnapshot({ leagueData, selectedTeamName, source = "active_autosave" } = {}) {
  if (!leagueHasTeams(leagueData)) return null;
  const activeId = getActiveLeagueSaveId();
  if (activeId) {
    return updateLeagueSaveSnapshot(activeId, { leagueData, selectedTeamName, source });
  }
  return createLeagueSave({
    leagueName: "Recovered League",
    leagueData,
    selectedTeamName,
    activate: true,
    source: `${source}:recovered`,
  });
}

export function updateActiveLeagueSaveSnapshotInBackground(payload = {}) {
  updateActiveLeagueSaveSnapshot(payload).catch((error) => {
    console.warn("[leagueSaves] Could not update active league save slot.", error);
  });
}

export async function renameLeagueSave(saveId, leagueName) {
  const existing = await getLeagueSave(saveId);
  if (!existing) throw new Error("Save slot not found.");
  const cleanLeagueName = String(leagueName || "").trim() || existing.leagueName || "Untitled League";
  await assertUniqueLeagueName(cleanLeagueName, { ignoreSaveId: existing.saveId });
  const renamed = {
    ...existing,
    leagueName: cleanLeagueName,
    updatedAt: new Date().toISOString(),
  };
  const normalized = migrateLeagueSave(renamed);
  await upsertLeagueSave(normalized);
  return normalized;
}

export async function deleteLeagueSave(saveId) {
  const id = String(saveId || "").trim();
  if (!id) return;
  await runTransaction("readwrite", (store) => store.delete(id));
  if (getActiveLeagueSaveId() === id) clearActiveLeagueSaveId();
}

export async function restoreLeagueSaveToActive(saveId, { setLeagueData, setSelectedTeam } = {}) {
  const record = await getLeagueSave(saveId);
  if (!record?.snapshot?.leagueData) throw new Error("This save slot has no league data to load.");

  const leagueData = clone(record.snapshot.leagueData);
  const selectedTeamName = record.snapshot.selectedTeamName || record.controlledTeamName || "";

  setActiveLeagueSaveId(record.saveId);
  await saveLeagueData(leagueData, { source: "restoreLeagueSaveToActive" });

  try {
    if (selectedTeamName) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeamName));
    else localStorage.removeItem("selectedTeam");
    window.__leagueData = leagueData;
    window.leagueData = leagueData;
  } catch {}

  if (typeof setLeagueData === "function") setLeagueData(leagueData, { source: "restoreLeagueSaveToActive" });
  if (typeof setSelectedTeam === "function") setSelectedTeam(selectedTeamName || null);

  return { record, leagueData, selectedTeamName };
}

export function downloadLeagueSaveBackup(record) {
  const migrated = migrateLeagueSave(record);
  if (!migrated || typeof document === "undefined") return;

  const blob = new Blob([JSON.stringify(migrated, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safeName = String(migrated.leagueName || "league-save")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "league-save";
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.basketball-manager-save.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
