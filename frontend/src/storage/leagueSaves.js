import { saveLeagueData } from "../utils/leagueStorage.js";
import {
  captureActiveLeagueRuntime,
  restoreLeagueRuntime,
} from "./saveManager.js";

export const CURRENT_LEAGUE_SAVE_SCHEMA_VERSION = 2;
export const MAX_LEAGUE_SAVE_SLOTS = 5;

const DB_NAME = "basketball_manager_local_save_slots_v1";
const DB_VERSION = 1;
const STORE_NAME = "leagueSaves";
const ACTIVE_SAVE_KEY = "bm_active_league_save_id_v1";

let saveMutationChain = Promise.resolve();

const SAFE_RESUME_ROUTES = new Set([
  "/team-hub", "/roster-view", "/coach-gameplan", "/calendar", "/player-stats",
  "/playoff-stats", "/draft-lottery", "/draft", "/upcoming-draft", "/rookie-signings",
  "/roster-finalization", "/standings", "/power-rankings", "/draft-picks", "/trades",
  "/propose-trade", "/trade-player-select", "/trade-pick-select", "/trade-finder",
  "/locker-room", "/contract-extensions", "/intel", "/settings", "/league-history",
  "/award-history", "/past-champions", "/playoffs", "/playoff-picture", "/player-progression",
  "/salary-table", "/free-agents", "/award-tracker", "/all-stars", "/offseason",
  "/player-team-options", "/player-retirements", "/viewing-offers", "/team-selector",
]);

function hasIndexedDB() {
  try { return typeof indexedDB !== "undefined"; } catch { return false; }
}

function hasLocalStorage() {
  try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; }
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
  try { if (typeof structuredClone === "function") return structuredClone(value); } catch {}
  return JSON.parse(JSON.stringify(value));
}

function safeDate(value = null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizeLeagueName(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
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
    } catch { return ""; }
  })();
  if (saved) return saved;
  return "";
}

function resolveSeasonLabel(leagueData = null) {
  const seasonYear = Number(leagueData?.seasonYear || leagueData?.currentSeasonYear || leagueData?.seasonStartYear || leagueData?.year || 0);
  if (Number.isFinite(seasonYear) && seasonYear > 0) return `Season ${seasonYear}-${String(seasonYear + 1).slice(-2)}`;
  return "Season not started";
}

function currentRoute() {
  try { return window.location?.pathname || ""; } catch { return ""; }
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
    appVersion: "local-save-slots-v2",
    controlledTeamName: teamName || "No team selected",
    seasonLabel: resolveSeasonLabel(leagueData),
    teamCount: getTeams(leagueData).length,
  };
}

function buildSaveRecord({
  existing = null,
  saveId,
  leagueName,
  leagueData,
  selectedTeamName,
  createdAt,
  updatedAt,
  source = "unknown",
  runtime,
  savedRoute,
} = {}) {
  const metadata = buildMetadata({ saveId, leagueName, leagueData, selectedTeamName, createdAt, updatedAt });
  const previousSnapshot = existing?.snapshot && typeof existing.snapshot === "object" ? existing.snapshot : {};
  const hasRuntimeArgument = runtime !== undefined;
  return {
    ...metadata,
    snapshot: {
      leagueData: clone(leagueData),
      selectedTeamName: resolveTeamName(leagueData, selectedTeamName),
      savedRoute: String(savedRoute ?? currentRoute() ?? previousSnapshot.savedRoute ?? ""),
      savedAt: metadata.updatedAt,
      source,
      runtime: clone(hasRuntimeArgument ? runtime : previousSnapshot.runtime ?? null),
    },
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) { reject(new Error("IndexedDB is not available in this browser.")); return; }
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
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    let tx; let store; let request = null;
    try {
      tx = db.transaction(STORE_NAME, mode);
      store = tx.objectStore(STORE_NAME);
      request = callback(store);
    } catch (error) { db.close(); reject(error); return; }
    if (request) request.onerror = () => reject(request.error || new Error("Local save request failed."));
    tx.oncomplete = () => { const result = request?.result ?? null; db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Local save transaction failed.")); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Local save transaction aborted.")); };
  }));
}

function enqueueSaveMutation(operation) {
  const task = saveMutationChain.then(operation);
  saveMutationChain = task.catch(() => {});
  return task;
}

async function writeLeagueSaveRecord(record) {
  await runTransaction("readwrite", (store) => store.put(record));
  return record;
}

async function assertUniqueLeagueName(leagueName, { ignoreSaveId = "" } = {}) {
  const normalized = normalizeLeagueName(leagueName);
  if (!normalized) throw new Error("League name is required.");
  const existingSaves = await listLeagueSaves();
  const duplicate = existingSaves.find((save) => save?.saveId && (!ignoreSaveId || String(save.saveId) !== String(ignoreSaveId)) && normalizeLeagueName(save.leagueName) === normalized);
  if (duplicate) throw new Error("A league with this name already exists. Choose a different name.");
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

export function clearActiveLeagueSaveId() { setActiveLeagueSaveId(""); }

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
      savedRoute: snapshot.savedRoute || "",
      savedAt: snapshot.savedAt || record.updatedAt || new Date().toISOString(),
      runtime: snapshot.runtime && typeof snapshot.runtime === "object" ? snapshot.runtime : null,
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
  return { ...migrated, ...metadata, schemaVersion: migrated.snapshot.runtime ? CURRENT_LEAGUE_SAVE_SCHEMA_VERSION : Math.max(1, migrated.schemaVersion) };
}

export async function flushLeagueSaveSlotWrites() { await saveMutationChain.catch(() => {}); }

export async function listLeagueSaves() {
  const records = await runTransaction("readonly", (store) => store.getAll());
  return (records || []).map(migrateLeagueSave).filter(Boolean).filter((save) => {
    const name = normalizeLeagueName(save?.leagueName || "");
    const source = String(save?.snapshot?.source || "").toLowerCase();
    return !(name === "recovered league" && source.includes("recovered"));
  }).sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

export async function getLeagueSave(saveId) {
  const id = String(saveId || "").trim();
  if (!id) return null;
  return migrateLeagueSave(await runTransaction("readonly", (store) => store.get(id)));
}

export async function upsertLeagueSave(record) {
  const migrated = migrateLeagueSave(record);
  if (!migrated) throw new Error("Cannot save an empty league slot.");
  return enqueueSaveMutation(() => writeLeagueSaveRecord(migrated));
}

export async function createLeagueSave({ leagueName, leagueData, selectedTeamName, activate = true, source = "create" } = {}) {
  if (!leagueHasTeams(leagueData)) throw new Error("Cannot create a save before a roster is loaded.");
  const cleanLeagueName = String(leagueName || "").trim() || "Untitled League";
  const existingSaves = await listLeagueSaves();
  if (existingSaves.length >= MAX_LEAGUE_SAVE_SLOTS) {
    throw new Error(`You can keep up to ${MAX_LEAGUE_SAVE_SLOTS} league saves. Delete a save before starting another league.`);
  }
  await assertUniqueLeagueName(cleanLeagueName);
  await flushLeagueSaveSlotWrites();
  const captured = await captureActiveLeagueRuntime({ leagueData });
  const now = new Date().toISOString();
  const record = buildSaveRecord({
    leagueName: cleanLeagueName,
    leagueData: captured.leagueData || leagueData,
    selectedTeamName,
    createdAt: now,
    updatedAt: now,
    source,
    runtime: captured.runtime,
  });
  await enqueueSaveMutation(() => writeLeagueSaveRecord(record));
  if (activate) setActiveLeagueSaveId(record.saveId);
  return record;
}

export async function updateLeagueSaveSnapshot(saveId, { leagueName, leagueData, selectedTeamName, source = "update", runtime, savedRoute } = {}) {
  const id = String(saveId || "").trim();
  if (!id || !leagueHasTeams(leagueData)) return null;
  return enqueueSaveMutation(async () => {
    const existing = (await getLeagueSave(id)) || {};
    const now = new Date().toISOString();
    const record = buildSaveRecord({
      existing,
      saveId: id,
      leagueName: leagueName || existing.leagueName || "Untitled League",
      leagueData,
      selectedTeamName,
      createdAt: existing.createdAt || now,
      updatedAt: now,
      source,
      runtime,
      savedRoute,
    });
    return writeLeagueSaveRecord(record);
  });
}

export async function updateActiveLeagueSaveSnapshot({ leagueData, selectedTeamName, source = "active_autosave" } = {}) {
  if (!leagueHasTeams(leagueData)) return null;
  const activeId = getActiveLeagueSaveId();
  if (!activeId) return null;
  return updateLeagueSaveSnapshot(activeId, { leagueData, selectedTeamName, source });
}

export function updateActiveLeagueSaveSnapshotInBackground(payload = {}) {
  updateActiveLeagueSaveSnapshot(payload).catch((error) => console.warn("[leagueSaves] Could not update active league save slot.", error));
}

export async function checkpointActiveLeagueSave({ leagueData, selectedTeamName, source = "manual_checkpoint", savedRoute } = {}) {
  if (!leagueHasTeams(leagueData)) return null;
  const activeId = getActiveLeagueSaveId();
  if (!activeId) return null;
  await flushLeagueSaveSlotWrites();
  const captured = await captureActiveLeagueRuntime({ leagueData });
  return updateLeagueSaveSnapshot(activeId, {
    leagueData: captured.leagueData || leagueData,
    selectedTeamName,
    source,
    runtime: captured.runtime,
    savedRoute: savedRoute ?? currentRoute(),
  });
}

export async function renameLeagueSave(saveId, leagueName) {
  const cleanId = String(saveId || "").trim();
  const existing = await getLeagueSave(cleanId);
  if (!existing) throw new Error("Save slot not found.");
  const cleanLeagueName = String(leagueName || "").trim() || existing.leagueName || "Untitled League";
  await assertUniqueLeagueName(cleanLeagueName, { ignoreSaveId: existing.saveId });
  return enqueueSaveMutation(async () => {
    const latest = (await getLeagueSave(cleanId)) || existing;
    const normalized = migrateLeagueSave({ ...latest, leagueName: cleanLeagueName, updatedAt: new Date().toISOString() });
    return writeLeagueSaveRecord(normalized);
  });
}

export async function deleteLeagueSave(saveId) {
  const id = String(saveId || "").trim();
  if (!id) return;
  await enqueueSaveMutation(() => runTransaction("readwrite", (store) => store.delete(id)));
  if (getActiveLeagueSaveId() === id) clearActiveLeagueSaveId();
}

export function getResumeRouteForLeagueSave(record = null) {
  const selectedTeamName = record?.snapshot?.selectedTeamName || record?.controlledTeamName || "";
  const route = String(record?.snapshot?.savedRoute || "").trim();
  if (route === "/team-selector" && !selectedTeamName) return route;
  if (selectedTeamName && SAFE_RESUME_ROUTES.has(route) && route !== "/team-selector") return route;
  return selectedTeamName ? "/team-hub" : "/team-selector";
}

export async function restoreLeagueSaveToActive(saveId, { setLeagueData, setSelectedTeam } = {}) {
  await flushLeagueSaveSlotWrites();
  const record = await getLeagueSave(saveId);
  if (!record?.snapshot?.leagueData) throw new Error("This save slot has no league data to load.");

  const leagueData = clone(record.snapshot.leagueData);
  const selectedTeamName = record.snapshot.selectedTeamName || record.controlledTeamName || "";

  await restoreLeagueRuntime({
    runtime: record.snapshot.runtime,
    leagueData,
    selectedTeamName,
  });

  setActiveLeagueSaveId(record.saveId);
  try {
    window.__leagueData = leagueData;
    window.leagueData = leagueData;
  } catch {}

  if (typeof setLeagueData === "function") setLeagueData(leagueData, { source: "restoreLeagueSaveToActive", persist: false });
  if (typeof setSelectedTeam === "function") setSelectedTeam(selectedTeamName || null);

  return {
    record,
    leagueData,
    selectedTeamName,
    resumeRoute: getResumeRouteForLeagueSave(record),
    migratedFromV1: !record.snapshot.runtime,
  };
}

export function downloadLeagueSaveBackup(record) {
  const migrated = migrateLeagueSave(record);
  if (!migrated || typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(migrated, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safeName = String(migrated.leagueName || "league-save").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "league-save";
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.basketball-manager-save.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
