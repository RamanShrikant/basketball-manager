/**
 * Browser-local, per-Supabase-user franchise vault.
 * Account IDs are used only as local namespace identifiers. Nothing uploads here.
 * The ACTIVE browser game still uses the original DBs and storage keys so the
 * simulation, league saves, and all other gameplay systems are unchanged.
 *
 * Failure policy: keep prior data recoverable; never proceed to game if a
 * snapshot or restore operation fails. Switching accounts requires a reload.
 */
import { prepareCloudRestoreDatabases } from "./cloudSaveSchemas.js";
import {
  captureLeagueLocalStorage, captureLeagueSessionStorage,
  clearLeagueLocalStorage, clearLeagueSessionStorage,
  restoreLeagueLocalStorage, restoreLeagueSessionStorage,
} from "../storage/saveStorageRegistry.js";

export const BM_ACCOUNT_OWNER_KEY = "bm_account_vault_owner_v1";
const BM_ACCOUNT_SWITCH_KEY = "bm_account_vault_pending_v1";
const VAULT_DB = "bm_account_local_vault_v1";
const VAULT_STORE = "profiles";
const LEGACY_ID = "__legacy_unclaimed__";
const GAME_DB_PREFIX = "basketball_manager_";
const ACCOUNT_ACTIVE_SAVE_KEY = "bm_active_league_save_id_v1";
const SAVE_MODE_KEY = "bm_save_mode_active_v1_";
const SAVE_MODE_INTENT_KEY = "bm_save_mode_requested_v1_";
const VALID_MODES = new Set(["local", "cloud"]);

export function getAccountSaveMode(userId) {
  const id = validateAccountId(userId);
  const saved = localStorage.getItem(`${SAVE_MODE_KEY}${id}`);
  return VALID_MODES.has(saved) ? saved : "local";
}

export function requestAccountSaveMode(userId, mode) {
  const id = validateAccountId(userId);
  if (!VALID_MODES.has(mode)) throw new Error("Unrecognized single-player save mode.");
  localStorage.setItem(`${SAVE_MODE_INTENT_KEY}${id}`, mode);
}

export function readRequestedSaveMode(userId) {
  const value = localStorage.getItem(`${SAVE_MODE_INTENT_KEY}${validateAccountId(userId)}`);
  return VALID_MODES.has(value) ? value : null;
}

export function clearRequestedSaveMode(userId) {
  localStorage.removeItem(`${SAVE_MODE_INTENT_KEY}${validateAccountId(userId)}`);
}

const modeVaultId = (id, mode) => `__bm_singleplayer_mode_${mode}_${id}`;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i;

export function validateAccountId(id) {
  const value = String(id || "");
  if (!ID_PATTERN.test(value)) throw new Error("Missing or invalid authenticated account ID.");
  return value;
}

export function activeBrowserAccountId() {
  return localStorage.getItem(BM_ACCOUNT_OWNER_KEY) || "";
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function openDb(name, version) {
  return new Promise((resolve, reject) => {
    const req = version == null ? indexedDB.open(name) : indexedDB.open(name, version);
    if (name === VAULT_DB) {
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(VAULT_STORE)) {
          req.result.createObjectStore(VAULT_STORE, { keyPath: "id" });
        }
      };
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error(`Could not open ${name}`));
    req.onblocked = () => reject(new Error(`Database ${name} is open in another tab. Close other game tabs.`));
  });
}

function runTransaction(db, storeNames, mode, operation) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeNames, mode);
      operation(transaction);
    } catch (e) { reject(e); return; }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Storage transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("Storage transaction aborted"));
  });
}

async function listGameDbNames() {
  // Browser support is required to avoid accidentally creating phantom game DBs.
  if (typeof indexedDB?.databases !== "function") {
    throw new Error("Your browser does not support safe account-local IndexedDB switching. Use recent Chrome or Edge.");
  }
  const databases = await indexedDB.databases();
  return databases.map(row => String(row.name || ""))
    .filter(name => name.startsWith(GAME_DB_PREFIX) && name !== VAULT_DB);
}

async function captureDb(name) {
  const db = await openDb(name);
  try {
    const names = [...db.objectStoreNames];
    const stores = {};
    for (const storeName of names) {
      const tx = db.transaction([storeName], "readonly");
      stores[storeName] = await requestValue(tx.objectStore(storeName).getAll());
    }
    return { stores };
  } finally { db.close(); }
}

async function captureLive() {
  const dbs = {};
  for (const name of await listGameDbNames()) dbs[name] = await captureDb(name);
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    activeSaveId: localStorage.getItem(ACCOUNT_ACTIVE_SAVE_KEY) || "",
    local: captureLeagueLocalStorage(),
    session: captureLeagueSessionStorage(),
    dbs,
  };
}

async function putVault(id, payload) {
  const db = await openDb(VAULT_DB, 1);
  try {
    await runTransaction(db, [VAULT_STORE], "readwrite", tx => {
      tx.objectStore(VAULT_STORE).put({ id, payload, savedAt: Date.now() });
    });
  } finally { db.close(); }
}

async function readVault(id) {
  const db = await openDb(VAULT_DB, 1);
  try {
    return (await requestValue(db.transaction([VAULT_STORE], "readonly").objectStore(VAULT_STORE).get(id)))?.payload || null;
  } finally { db.close(); }
}

async function rewriteDb(name, targetStores = {}) {
  // DB schemas remain owned by the existing game. If the expected store does not
  // exist, STOP instead of creating an incompatible database version.
  const db = await openDb(name);
  try {
    const names = [...db.objectStoreNames];
    for (const storeName of Object.keys(targetStores)) {
      if (!names.includes(storeName)) throw new Error(`Missing expected game store ${name}/${storeName}`);
    }
    if (!names.length) return;
    await runTransaction(db, names, "readwrite", tx => {
      for (const storeName of names) {
        const store = tx.objectStore(storeName);
        store.clear();
        for (const row of targetStores[storeName] || []) store.put(row);
      }
    });
  } finally { db.close(); }
}

async function restoreLive(snapshot = null) {
  // Capture names before clearing. Do not erase accounts' snapshots themselves.
  const liveNames = await listGameDbNames();
  const targetDbs = snapshot?.dbs || {};
  const targetNames = Object.keys(targetDbs);
  // If a target db does not currently exist, the app will generate its schema
  // on first boot. Refuse to inject nonempty rows into a missing schema.
  for (const name of targetNames) {
    if (!liveNames.includes(name) && Object.values(targetDbs[name]?.stores || {}).some(rows => rows?.length)) {
      throw new Error(`Account database ${name} is missing. No files were deleted.`);
    }
  }
  // All validations should precede any clearing as far as possible.
  for (const name of liveNames) await rewriteDb(name, targetDbs[name]?.stores || {});
  restoreLeagueLocalStorage(snapshot?.local || {});
  restoreLeagueSessionStorage(snapshot?.session || {});
  // The game's save registry treats the active slot ID as league-global.
  // Account switching must explicitly restore it to prevent cross-account writes.
  if (snapshot?.activeSaveId) localStorage.setItem(ACCOUNT_ACTIVE_SAVE_KEY, snapshot.activeSaveId);
  else localStorage.removeItem(ACCOUNT_ACTIVE_SAVE_KEY);
}

export async function inspectInitialOwnership(userId) {
  validateAccountId(userId);
  const owner = activeBrowserAccountId();
  if (owner) return { needsDecision: false };
  const current = await captureLive();
  const hasExisting = Object.keys(current.local).length > 0 ||
    Object.values(current.dbs).some(db => Object.values(db.stores).some(rows => rows.length));
  return { needsDecision: hasExisting };
}

export async function recoverInterruptedSwitch() {
  const raw = localStorage.getItem(BM_ACCOUNT_SWITCH_KEY);
  if (!raw) return;
  let pending;
  try { pending = JSON.parse(raw); } catch { throw new Error("Cannot recover interrupted account change. Contact developer before continuing."); }
  const prior = await readVault(pending.from);
  if (!prior) throw new Error("Account change was interrupted and previous account backup is missing. Do not use this browser until recovered.");
  await restoreLive(prior);
  if (pending.from === LEGACY_ID) localStorage.removeItem(BM_ACCOUNT_OWNER_KEY);
  else localStorage.setItem(BM_ACCOUNT_OWNER_KEY, pending.from);
  if (pending.modeFrom && VALID_MODES.has(pending.modeFrom) && pending.from !== LEGACY_ID) {
    localStorage.setItem(`${SAVE_MODE_KEY}${pending.from}`, pending.modeFrom);
  }
  localStorage.removeItem(BM_ACCOUNT_SWITCH_KEY);
}

export async function getStoredModeSnapshot(userId, mode) {
  const id = validateAccountId(userId);
  if (!VALID_MODES.has(mode)) throw new Error("Invalid save mode.");
  return readVault(modeVaultId(id, mode));
}

export async function switchAccountSaveMode(userId, targetMode) {
  const id = validateAccountId(userId);
  if (activeBrowserAccountId() !== id) throw new Error("Wrong account for save-mode switch.");
  if (!VALID_MODES.has(targetMode)) throw new Error("Invalid save mode.");
  await recoverInterruptedSwitch();
  const priorMode = getAccountSaveMode(id);
  if (priorMode === targetMode) return { switched: false, cached: true };

  // Work exclusively before importing GameContext/worker modules on a reload.
  // Retain both worlds in the account vault; never write Local into the cloud slot.
  const prior = await captureLive();
  await putVault(id, prior); // crash recovery snapshot
  await putVault(modeVaultId(id, priorMode), prior);
  localStorage.setItem(BM_ACCOUNT_SWITCH_KEY, JSON.stringify({ from: id, to: id, modeFrom: priorMode }));
  try {
    const next = await readVault(modeVaultId(id, targetMode));
    if (next) await prepareCloudRestoreDatabases(next);
    await restoreLive(next);
    await putVault(id, await captureLive());
    localStorage.setItem(`${SAVE_MODE_KEY}${id}`, targetMode);
    localStorage.removeItem(BM_ACCOUNT_SWITCH_KEY);
    return { switched: true, cached: Boolean(next) };
  } catch (error) {
    try { await recoverInterruptedSwitch(); }
    catch (recoveryError) {
      throw new Error(`Save-mode switch needs manual recovery: ${recoveryError.message}`);
    }
    throw error;
  }
}

export async function activateAccount(userId, { adoptLegacy = false } = {}) {
  const next = validateAccountId(userId);
  await recoverInterruptedSwitch();
  const current = activeBrowserAccountId();
  if (current === next) return { switched: false };
  const priorKey = current || LEGACY_ID;

  // Back up the LIVE universe completely before any replacement. For first
  // login, retain a separate legacy copy, even when adopting it.
  const currentSnapshot = await captureLive();
  await putVault(priorKey, currentSnapshot);
  if (!current && adoptLegacy) {
    localStorage.setItem(BM_ACCOUNT_OWNER_KEY, next);
    return { switched: false, adopted: true };
  }

  // Crash-recovery marker: if the browser closes during replacement, the next
  // startup restores the archived prior universe before any other operation.
  localStorage.setItem(BM_ACCOUNT_SWITCH_KEY, JSON.stringify({ from: priorKey, to: next }));
  try {
    const nextSnapshot = await readVault(next);
    await restoreLive(nextSnapshot);
    localStorage.setItem(BM_ACCOUNT_OWNER_KEY, next);
    localStorage.removeItem(BM_ACCOUNT_SWITCH_KEY);
    return { switched: true };
  } catch (error) {
    try { await recoverInterruptedSwitch(); } catch (recoveryError) {
      throw new Error(`Account switch failed and needs manual recovery: ${recoveryError.message}`);
    }
    throw error;
  }
}

export async function captureAccountCloudSnapshot(userId) {
  if (activeBrowserAccountId() !== validateAccountId(userId)) {
    throw new Error("Wrong account for cloud snapshot.");
  }
  return captureLive();
}

export async function restoreAccountCloudSnapshot(userId, snapshot) {
  const id = validateAccountId(userId);
  if (activeBrowserAccountId() !== id) throw new Error("Wrong account for cloud restore.");
  if (snapshot?.version !== 1 || !snapshot.dbs || !snapshot.local || !snapshot.session) {
    throw new Error("Invalid cloud save format.");
  }
  // New browsers do not have game DB schemas yet; prepare only known empty DBs.
  await prepareCloudRestoreDatabases(snapshot);
  const before = await captureLive();
  await putVault(`__cloud_restore_backup_${id}_${Date.now()}`, before);
  await putVault(id, before);
  localStorage.setItem(BM_ACCOUNT_SWITCH_KEY, JSON.stringify({ from: id, to: id }));
  try {
    await restoreLive(snapshot);
    await putVault(id, snapshot);
    localStorage.removeItem(BM_ACCOUNT_SWITCH_KEY);
  } catch (error) {
    try { await recoverInterruptedSwitch(); }
    catch (recoveryError) {
      throw new Error(`Cloud restore failed; manual recovery required: ${recoveryError.message}`);
    }
    throw error;
  }
}

export async function checkpointAccount(userId) {
  if (activeBrowserAccountId() !== validateAccountId(userId)) {
    throw new Error("The active browser franchise belongs to another account. Please reload.");
  }
  await putVault(userId, await captureLive());
}
