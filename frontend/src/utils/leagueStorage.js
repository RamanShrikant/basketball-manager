import {
  isMultiYearSpeedDiagnosticsEnabled,
  recordMultiYearStorageWrite,
} from "./multiYearSpeedDiagnostics.js";

const DB_NAME = "basketball_manager_league_storage_v2";
const DB_VERSION = 1;
const STORE_NAME = "league_saves";
const ACTIVE_LEAGUE_KEY = "active_league";
export const CPU_TRADE_BANK_OVERLAY_KEY = "active_cpu_trade_bank_overlay";
const CPU_TRADE_BANK_OVERLAY_VERSION = 1;
export const INJURY_STATE_OVERLAY_KEY = "active_injury_state_overlay";
const INJURY_STATE_OVERLAY_VERSION = 1;
const LEAGUE_STORAGE_ID_FIELD = "__leagueStorageId";
const INJURY_STATE_REVISION_FIELD = "__injuryStateRevision";

const LEGACY_DB_NAMES = [
  "basketball_manager_storage_v1",
];

const STORAGE_MODE_KEY = "leagueDataStorageMode";
const STORAGE_POINTER_KEY = "leagueDataIndexedDbPointer";
const LAST_SAVED_KEY = "leagueDataLastSavedAt";

let originalLocalStorageSetItem = null;
let leagueDataSaveInProgress = false;
let leagueStorageIdentitySequence = 0;

function hasIndexedDB() {
  return typeof indexedDB !== "undefined";
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch {
    return false;
  }
}

function rawSetLocalStorageItem(key, value) {
  if (!hasLocalStorage()) return;

  if (originalLocalStorageSetItem) {
    originalLocalStorageSetItem.call(localStorage, key, value);
    return;
  }

  localStorage.setItem(key, value);
}

function rawRemoveLocalStorageItem(key) {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(key);
}

function safeJsonParse(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function leagueHasTeams(leagueData) {
  return getAllTeamsFromLeague(leagueData).length > 0;
}

function normalizeFingerprintToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildLeagueTeamFingerprint(leagueData = null) {
  return getAllTeamsFromLeague(leagueData)
    .map((team) => normalizeFingerprintToken(team?.name || team?.teamName || team?.team || ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

function createLeagueStorageId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}

  leagueStorageIdentitySequence += 1;
  return `bm_${Date.now().toString(36)}_${leagueStorageIdentitySequence.toString(36)}`;
}

export function ensureLeagueStorageIdentity(leagueData = null) {
  if (!leagueData || typeof leagueData !== "object") return "";
  const existing = String(leagueData?.[LEAGUE_STORAGE_ID_FIELD] || "").trim();
  if (existing) return existing;
  const created = createLeagueStorageId();
  leagueData[LEAGUE_STORAGE_ID_FIELD] = created;
  return created;
}

export function getLeagueInjuryStateRevision(leagueData = null) {
  const revision = Number(leagueData?.[INJURY_STATE_REVISION_FIELD] || 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function markLeagueInjuryStateChanged(leagueData = null) {
  if (!leagueData || typeof leagueData !== "object") return 0;
  ensureLeagueStorageIdentity(leagueData);
  const current = getLeagueInjuryStateRevision(leagueData);
  const next = current >= Number.MAX_SAFE_INTEGER - 1 ? 1 : current + 1;
  leagueData[INJURY_STATE_REVISION_FIELD] = next;
  return next;
}

function playerStorageId(player = {}) {
  const raw = player?.id ?? player?.playerId;
  if (raw === undefined || raw === null || raw === "") return "";
  return String(raw);
}

function playerStorageName(player = {}) {
  return String(player?.name || player?.player || "").trim();
}

function buildInjuryRows(leagueData = null) {
  const rows = [];
  for (const team of getAllTeamsFromLeague(leagueData)) {
    const teamName = String(team?.name || team?.teamName || team?.team || "").trim();
    for (const player of team?.players || []) {
      const injury = player?.injury;
      if (!injury || typeof injury !== "object") continue;
      rows.push({
        teamName,
        playerId: playerStorageId(player),
        playerName: playerStorageName(player),
        injury: { ...injury },
      });
    }
  }
  return rows;
}

export function buildInjuryStateOverlayRecord(leagueData = null, updatedAt = Date.now()) {
  if (!leagueData || typeof leagueData !== "object") return null;
  const seasonYear = getSeasonYearForPointer(leagueData);
  const teamFingerprint = buildLeagueTeamFingerprint(leagueData);
  if (!seasonYear || !teamFingerprint) return null;

  const leagueStorageId = ensureLeagueStorageIdentity(leagueData);
  let revision = getLeagueInjuryStateRevision(leagueData);
  if (!revision) revision = markLeagueInjuryStateChanged(leagueData);

  return {
    id: INJURY_STATE_OVERLAY_KEY,
    version: INJURY_STATE_OVERLAY_VERSION,
    updatedAt: Number(updatedAt) || Date.now(),
    seasonYear,
    teamFingerprint,
    leagueStorageId,
    revision,
    injurySettings: { ...(leagueData?.settings?.injuries || {}) },
    activeInjuries: buildInjuryRows(leagueData),
  };
}

function isInjuryStateOverlayCompatible(leagueData = null, overlayRecord = null) {
  if (!leagueHasTeams(leagueData)) return { ok: false, reason: "missing_full_league" };
  if (!overlayRecord || typeof overlayRecord !== "object") return { ok: false, reason: "missing_overlay" };
  if (Number(overlayRecord?.version || 0) !== INJURY_STATE_OVERLAY_VERSION) {
    return { ok: false, reason: "overlay_version_mismatch" };
  }

  const leagueSeasonYear = getSeasonYearForPointer(leagueData);
  const overlaySeasonYear = Number(overlayRecord?.seasonYear || 0);
  if (!leagueSeasonYear || overlaySeasonYear !== leagueSeasonYear) {
    return { ok: false, reason: "season_mismatch" };
  }

  const expectedFingerprint = buildLeagueTeamFingerprint(leagueData);
  if (!expectedFingerprint || overlayRecord?.teamFingerprint !== expectedFingerprint) {
    return { ok: false, reason: "team_fingerprint_mismatch" };
  }

  const leagueStorageId = String(leagueData?.[LEAGUE_STORAGE_ID_FIELD] || "").trim();
  const overlayStorageId = String(overlayRecord?.leagueStorageId || "").trim();
  if (leagueStorageId && overlayStorageId && leagueStorageId !== overlayStorageId) {
    return { ok: false, reason: "league_identity_mismatch" };
  }

  return { ok: true, reason: "compatible" };
}

function applyInjuryStateOverlay(leagueData = null, overlayRecord = null) {
  const compatibility = isInjuryStateOverlayCompatible(leagueData, overlayRecord);
  if (!compatibility.ok) return { leagueData, applied: false, reason: compatibility.reason, matchedPlayers: 0, missingPlayers: 0 };

  if (!leagueData?.[LEAGUE_STORAGE_ID_FIELD] && overlayRecord?.leagueStorageId) {
    leagueData[LEAGUE_STORAGE_ID_FIELD] = String(overlayRecord.leagueStorageId);
  }

  const byId = new Map();
  const byTeamAndName = new Map();
  const byName = new Map();
  const duplicateNames = new Set();

  for (const team of getAllTeamsFromLeague(leagueData)) {
    const teamName = String(team?.name || team?.teamName || team?.team || "").trim();
    for (const player of team?.players || []) {
      const id = playerStorageId(player);
      const name = playerStorageName(player);
      if (id) byId.set(id, player);
      if (teamName && name) byTeamAndName.set(`${teamName}::${name}`, player);
      if (name) {
        if (byName.has(name)) duplicateNames.add(name);
        else byName.set(name, player);
      }
      // The overlay is an authoritative snapshot of the active injury set, so
      // players omitted from it represent recoveries/clears since the full save.
      player.injury = null;
    }
  }

  let matchedPlayers = 0;
  let missingPlayers = 0;
  for (const row of overlayRecord?.activeInjuries || []) {
    const id = String(row?.playerId || "");
    const name = String(row?.playerName || "").trim();
    const teamName = String(row?.teamName || "").trim();
    const player =
      (id ? byId.get(id) : null) ||
      (teamName && name ? byTeamAndName.get(`${teamName}::${name}`) : null) ||
      (name && !duplicateNames.has(name) ? byName.get(name) : null) ||
      null;

    if (!player) {
      missingPlayers += 1;
      continue;
    }

    player.injury = row?.injury && typeof row.injury === "object" ? { ...row.injury } : null;
    matchedPlayers += 1;
  }

  leagueData.settings = { ...(leagueData.settings || {}) };
  leagueData.settings.injuries = { ...(overlayRecord?.injurySettings || {}) };
  leagueData[INJURY_STATE_REVISION_FIELD] = Math.max(
    getLeagueInjuryStateRevision(leagueData),
    Number(overlayRecord?.revision || 0)
  );

  return {
    leagueData,
    applied: true,
    reason: "newer_compatible_injury_overlay",
    matchedPlayers,
    missingPlayers,
  };
}

export function mergeInjuryStateOverlayIntoLeague(leagueData = null, fullRecord = null, overlayRecord = null) {
  const compatibility = isInjuryStateOverlayCompatible(leagueData, overlayRecord);
  if (!compatibility.ok) return { leagueData, applied: false, reason: compatibility.reason, matchedPlayers: 0, missingPlayers: 0 };

  const leagueRevision = getLeagueInjuryStateRevision(leagueData);
  const overlayRevision = Number(overlayRecord?.revision || 0);
  const fullUpdatedAt = Number(fullRecord?.updatedAt || 0);
  const overlayUpdatedAt = Number(overlayRecord?.updatedAt || 0);

  if (overlayRevision < leagueRevision) {
    return { leagueData, applied: false, reason: "overlay_revision_older_than_full_save", matchedPlayers: 0, missingPlayers: 0 };
  }
  if (overlayRevision === leagueRevision && (!overlayUpdatedAt || overlayUpdatedAt <= fullUpdatedAt)) {
    return { leagueData, applied: false, reason: "overlay_not_newer_than_full_save", matchedPlayers: 0, missingPlayers: 0 };
  }

  return applyInjuryStateOverlay(leagueData, overlayRecord);
}

function reconcileNewerInjuryOverlayBeforeFullSave(leagueData = null, overlayRecord = null) {
  const compatibility = isInjuryStateOverlayCompatible(leagueData, overlayRecord);
  if (!compatibility.ok) return { leagueData, applied: false, reason: compatibility.reason };

  const leagueRevision = getLeagueInjuryStateRevision(leagueData);
  const overlayRevision = Number(overlayRecord?.revision || 0);
  if (overlayRevision <= leagueRevision) {
    return { leagueData, applied: false, reason: "incoming_full_save_is_current" };
  }

  return applyInjuryStateOverlay(leagueData, overlayRecord);
}

export function buildCpuTradeBankOverlayRecord(leagueData = null, updatedAt = Date.now()) {
  const bankState = leagueData?.cpuTradeBankState;
  if (!bankState || typeof bankState !== "object") return null;

  const seasonYear = getSeasonYearForPointer(leagueData);
  const bankSeasonYear = Number(bankState?.seasonYear || seasonYear || 0);
  if (!seasonYear || !Number.isFinite(bankSeasonYear) || bankSeasonYear !== seasonYear) return null;

  return {
    id: CPU_TRADE_BANK_OVERLAY_KEY,
    version: CPU_TRADE_BANK_OVERLAY_VERSION,
    updatedAt: Number(updatedAt) || Date.now(),
    seasonYear,
    teamFingerprint: buildLeagueTeamFingerprint(leagueData),
    bankVersion: Number(bankState?.version || 0),
    bankSeed: String(bankState?.seed || ""),
    cpuTradeBankState: bankState,
  };
}

export function mergeCpuTradeBankOverlayIntoLeague(leagueData = null, fullRecord = null, overlayRecord = null) {
  if (!leagueHasTeams(leagueData)) {
    return { leagueData, applied: false, reason: "missing_full_league" };
  }
  if (!overlayRecord || typeof overlayRecord !== "object") {
    return { leagueData, applied: false, reason: "missing_overlay" };
  }
  if (Number(overlayRecord?.version || 0) !== CPU_TRADE_BANK_OVERLAY_VERSION) {
    return { leagueData, applied: false, reason: "overlay_version_mismatch" };
  }

  const overlayState = overlayRecord?.cpuTradeBankState;
  if (!overlayState || typeof overlayState !== "object") {
    return { leagueData, applied: false, reason: "missing_bank_state" };
  }

  const leagueSeasonYear = getSeasonYearForPointer(leagueData);
  const overlaySeasonYear = Number(overlayRecord?.seasonYear || overlayState?.seasonYear || 0);
  const bankSeasonYear = Number(overlayState?.seasonYear || overlaySeasonYear || 0);
  if (!leagueSeasonYear || overlaySeasonYear !== leagueSeasonYear || bankSeasonYear !== leagueSeasonYear) {
    return { leagueData, applied: false, reason: "season_mismatch" };
  }

  const expectedFingerprint = buildLeagueTeamFingerprint(leagueData);
  if (!expectedFingerprint || overlayRecord?.teamFingerprint !== expectedFingerprint) {
    return { leagueData, applied: false, reason: "team_fingerprint_mismatch" };
  }

  const fullUpdatedAt = Number(fullRecord?.updatedAt || 0);
  const overlayUpdatedAt = Number(overlayRecord?.updatedAt || 0);
  if (!overlayUpdatedAt || overlayUpdatedAt < fullUpdatedAt) {
    return { leagueData, applied: false, reason: "overlay_older_than_full_save" };
  }

  return {
    leagueData: { ...leagueData, cpuTradeBankState: overlayState },
    applied: true,
    reason: "newer_compatible_overlay",
  };
}

function getSeasonYearForPointer(leagueData = null) {
  const y = Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      leagueData?.year ||
      0
  );

  return Number.isFinite(y) && y > 0 ? y : null;
}

function buildStoragePointer(leagueData = null, savedAt = Date.now()) {
  return {
    __storageMode: "indexedDB",
    __indexedDbKey: ACTIVE_LEAGUE_KEY,
    __indexedDbDbName: DB_NAME,
    __indexedDbStoreName: STORE_NAME,
    seasonYear: getSeasonYearForPointer(leagueData),
    savedAt,
  };
}

function writeLocalStoragePointerOnly(leagueData = null, savedAt = Date.now()) {
  try {
    const pointer = buildStoragePointer(leagueData, savedAt);
    rawSetLocalStorageItem("leagueData", JSON.stringify(pointer));
    return pointer;
  } catch {
    // IndexedDB remains the real save. Markers are helpful, not required.
    return null;
  }
}

function updateStorageMarkers(leagueData = null, savedAt = Date.now()) {
  try {
    const seasonYear = getSeasonYearForPointer(leagueData);

    rawSetLocalStorageItem(STORAGE_MODE_KEY, "indexedDB");
    rawSetLocalStorageItem(LAST_SAVED_KEY, String(savedAt));
    rawSetLocalStorageItem(
      STORAGE_POINTER_KEY,
      JSON.stringify({
        dbName: DB_NAME,
        storeName: STORE_NAME,
        key: ACTIVE_LEAGUE_KEY,
        savedAt,
        seasonYear,
      })
    );
  } catch {
    // Markers are helpful, but not required.
  }
}

function openLeagueDatabase() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        reject(new Error(`IndexedDB store missing: ${STORE_NAME}`));
        return;
      }

      resolve(db);
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB."));
    };

    request.onblocked = () => {
      console.warn("[leagueStorage] IndexedDB open/upgrade is blocked by another tab.");
    };
  });
}

function runStoreTransaction(mode, callback) {
  return openLeagueDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      let tx;
      let store;
      let request = null;

      try {
        tx = db.transaction(STORE_NAME, mode);
        store = tx.objectStore(STORE_NAME);
        request = callback(store);
      } catch (err) {
        db.close();
        reject(err);
        return;
      }

      if (request) {
        request.onerror = () => {
          reject(request.error || new Error("IndexedDB request failed."));
        };
      }

      tx.oncomplete = () => {
        const result = request?.result ?? null;
        db.close();
        resolve(result);
      };

      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB transaction failed."));
      };

      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB transaction was aborted."));
      };
    });
  });
}

function readLeagueDataFromLocalStorage() {
  if (!hasLocalStorage()) return null;

  const parsed = safeJsonParse(localStorage.getItem("leagueData"), null);

  if (!parsed || typeof parsed !== "object") return null;

  // Pointer-only save means localStorage no longer has the real league.
  if (parsed.__storageMode === "indexedDB" && !parsed.conferences && !parsed.teams) {
    return null;
  }

  return leagueHasTeams(parsed) ? parsed : null;
}

async function readLeagueDataFromLegacyIndexedDB() {
  if (!hasIndexedDB()) return null;

  for (const dbName of LEGACY_DB_NAMES) {
    try {
      const legacy = await new Promise((resolve) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.close();
            resolve(null);
            return;
          }

          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get(ACTIVE_LEAGUE_KEY);

          getReq.onsuccess = () => {
            const record = getReq.result;
            db.close();
            resolve(record?.leagueData || null);
          };

          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        };

        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });

      if (leagueHasTeams(legacy)) return legacy;
    } catch {
      // Ignore legacy read failures. The current DB or localStorage can still work.
    }
  }

  return null;
}

function compactStoryContext(story) {
  if (!story || typeof story !== "object") return undefined;

  return {
    headline: story.headline || "",
    subtitle: story.subtitle || story.contractLine || "",
    playerName: story.playerName || "",
    teamName: story.teamName || "",
    contractLine: story.contractLine || "",
  };
}

function compactOffer(offer) {
  if (!offer || typeof offer !== "object") return offer;

  return {
    offerId: offer.offerId || null,
    playerId: offer.playerId ?? null,
    playerName: offer.playerName || "",
    playerKey: offer.playerKey || "",
    teamName: offer.teamName || "",
    source: offer.source || "",
    status: offer.status || "active",
    submittedDay: offer.submittedDay ?? offer.day ?? null,
    day: offer.day ?? offer.submittedDay ?? null,
    contract: offer.contract || null,
    years: offer.years || offer.contract?.salaryByYear?.length || 0,
    totalValue: offer.totalValue || 0,
    aav: offer.aav || 0,
    playerViewScore: offer.playerViewScore || 0,
    spendingType: offer.spendingType || "",
    exceptionType: offer.exceptionType || "",
    payrollZone: offer.payrollZone || "",
    teamDirection: offer.teamDirection || "",
    rfaOfferSheet: Boolean(offer.rfaOfferSheet),
    rfaMatched: Boolean(offer.rfaMatched),
    rightsTeamName: offer.rightsTeamName || "",
    originalOfferTeamName: offer.originalOfferTeamName || "",
  };
}

function compactSigning(row) {
  if (!row || typeof row !== "object") return row;

  return {
    day: row.day ?? null,
    playerId: row.playerId ?? null,
    playerName: row.playerName || "",
    playerKey: row.playerKey || "",
    teamName: row.teamName || row.signedWith || "",
    signedWith: row.signedWith || row.teamName || "",
    contract: row.contract || row.signedContract || null,
    totalValue: row.totalValue || row.signedTotalValue || 0,
    aav: row.aav || 0,
    years: row.years || row.signedYears || row.contract?.salaryByYear?.length || 0,
    spendingType: row.spendingType || "",
    exceptionType: row.exceptionType || "",
    payrollZone: row.payrollZone || "",
    rfaMatched: Boolean(row.rfaMatched),
    originalOfferTeamName: row.originalOfferTeamName || "",
    matchedOriginalTeamName: row.matchedOriginalTeamName || "",
    storyContext: compactStoryContext(row.storyContext),
  };
}

function compactFreeAgencyStateForMirror(state) {
  if (!state || typeof state !== "object") return state;

  const offersByPlayer = {};
  for (const [playerKey, offers] of Object.entries(state.offersByPlayer || {})) {
    offersByPlayer[playerKey] = Array.isArray(offers)
      ? offers.slice(0, 8).map(compactOffer)
      : offers;
  }

  return {
    seasonYear: state.seasonYear ?? null,
    isActive: Boolean(state.isActive),
    currentDay: Number(state.currentDay || 0),
    maxDays: Number(state.maxDays || 10),
    offersByPlayer,
    pendingUserDecisions: Array.isArray(state.pendingUserDecisions)
      ? state.pendingUserDecisions.slice(0, 12).map(compactSigning)
      : [],
    pendingRfaMatchDecisions: Array.isArray(state.pendingRfaMatchDecisions)
      ? state.pendingRfaMatchDecisions.slice(0, 12).map(compactSigning)
      : [],
    exceptionUsageByTeam: state.exceptionUsageByTeam || {},
    pendingUserTeamName: state.pendingUserTeamName || null,
    pendingUserTeamSnapshot: state.pendingUserTeamSnapshot || null,
    latestResults: state.latestResults
      ? {
          dayResolved: state.latestResults.dayResolved ?? null,
          stateSummary: state.latestResults.stateSummary || null,
          signings: Array.isArray(state.latestResults.signings)
            ? state.latestResults.signings.slice(0, 30).map(compactSigning)
            : [],
          generatedOffers: Array.isArray(state.latestResults.generatedOffers)
            ? state.latestResults.generatedOffers.slice(0, 40).map(compactOffer)
            : [],
        }
      : null,
    signedPlayersLog: Array.isArray(state.signedPlayersLog)
      ? state.signedPlayersLog.slice(-60).map(compactSigning)
      : [],
    offerHistory: Array.isArray(state.offerHistory)
      ? state.offerHistory.slice(-60).map(compactOffer)
      : [],
    dailyLog: Array.isArray(state.dailyLog) ? state.dailyLog.slice(-8) : [],
    userOfferOutcomeLog: Array.isArray(state.userOfferOutcomeLog)
      ? state.userOfferOutcomeLog.slice(-40).map(compactSigning)
      : [],
    marketComplete: Boolean(state.marketComplete),
    freeAgencyComplete: Boolean(state.freeAgencyComplete),
    completed: Boolean(state.completed),
    isComplete: Boolean(state.isComplete),
    status: state.status || (state.isActive ? "active" : "not_started"),
    storageMirror: true,
  };
}

function buildLocalStorageFallbackMirror(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const mirror = {
    ...leagueData,
    freeAgencyState: compactFreeAgencyStateForMirror(leagueData.freeAgencyState),
    __storageMode: "localStorage_fallback",
    __fallbackSavedAt: Date.now(),
  };

  delete mirror.fullActionLog;
  delete mirror.freeAgencyDebugErrors;

  return mirror;
}

function writeLocalStorageFallbackMirror(leagueData) {
  const mirror = buildLocalStorageFallbackMirror(leagueData);
  rawSetLocalStorageItem("leagueData", JSON.stringify(mirror));
}

export async function saveLeagueData(leagueData, diagnostics = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  // Storage identity is metadata only. It lets tiny sidecars prove they belong
  // to this exact league instead of another NBA league with the same 30 teams.
  ensureLeagueStorageIdentity(leagueData);

  const diagnosticsEnabled = isMultiYearSpeedDiagnosticsEnabled();
  const diagnosticStartedAt = diagnosticsEnabled
    ? (typeof performance !== "undefined" ? performance.now() : Date.now())
    : 0;
  let diagnosticOk = false;
  let persistedLeagueData = leagueData;
  let savedAt = Date.now();
  try {
    leagueDataSaveInProgress = true;

    await runStoreTransaction("readwrite", (store) => {
      // Read and reconcile the injury sidecar INSIDE the same read/write
      // transaction as the full save. IndexedDB serializes writers, so a stale
      // full-league snapshot cannot land after a newer injury/recovery snapshot
      // and silently erase it.
      const injuryOverlayRequest = store.get(INJURY_STATE_OVERLAY_KEY);

      injuryOverlayRequest.onsuccess = () => {
        const reconciliation = reconcileNewerInjuryOverlayBeforeFullSave(
          persistedLeagueData,
          injuryOverlayRequest.result
        );
        persistedLeagueData = reconciliation.leagueData || persistedLeagueData;
        ensureLeagueStorageIdentity(persistedLeagueData);
        savedAt = Date.now();

        store.put({
          id: ACTIVE_LEAGUE_KEY,
          leagueData: persistedLeagueData,
          updatedAt: savedAt,
          version: 5,
        });

        // A full league snapshot already contains both current sidecar states.
        // Clear them in this SAME transaction so no older overlay can survive
        // a roster, ownership, reset, offseason, or trade-history save.
        store.delete(CPU_TRADE_BANK_OVERLAY_KEY);
        store.delete(INJURY_STATE_OVERLAY_KEY);
      };

      return injuryOverlayRequest;
    });

    updateStorageMarkers(persistedLeagueData, savedAt);
    writeLocalStoragePointerOnly(persistedLeagueData, savedAt);

    try {
      if (typeof window !== "undefined") {
        window.__leagueData = persistedLeagueData;
        window.__basketballManagerLeagueData = persistedLeagueData;
      }
    } catch {}

    diagnosticOk = true;
    return persistedLeagueData;
  } catch (err) {
    console.error("[leagueStorage] IndexedDB save failed. Falling back to compact localStorage mirror.", err);

    // Last-resort fallback only. Normal browsers should keep the real save in IndexedDB
    // and only a tiny pointer in localStorage.
    try {
      writeLocalStorageFallbackMirror(persistedLeagueData);
    } catch (fallbackErr) {
      console.error("[leagueStorage] localStorage fallback mirror also failed.", fallbackErr);
    }

    return persistedLeagueData;
  } finally {
    leagueDataSaveInProgress = false;
    if (diagnosticsEnabled) {
      const diagnosticEndedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      recordMultiYearStorageWrite({
        seasonYear: Number(persistedLeagueData?.seasonYear ?? persistedLeagueData?.currentSeasonYear ?? persistedLeagueData?.year ?? 0),
        mode: "full_league",
        source: diagnostics?.source || "direct",
        durationMs: diagnosticEndedAt - diagnosticStartedAt,
        ok: diagnosticOk,
      });
    }
  }
}

export async function saveCpuTradeBankStateOverlay(leagueData, diagnostics = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  ensureLeagueStorageIdentity(leagueData);

  const diagnosticsEnabled = isMultiYearSpeedDiagnosticsEnabled();
  const diagnosticStartedAt = diagnosticsEnabled
    ? (typeof performance !== "undefined" ? performance.now() : Date.now())
    : 0;
  let diagnosticOk = false;
  const savedAt = Date.now();
  const overlayRecord = buildCpuTradeBankOverlayRecord(leagueData, savedAt);
  if (!overlayRecord) {
    // Missing or incompatible bank state is not safe to represent as a sidecar.
    if (diagnosticsEnabled) {
      recordMultiYearStorageWrite({
        seasonYear: Number(leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.year ?? 0),
        mode: "bank_overlay",
        source: diagnostics?.source || "cpu_trade_overlay",
        durationMs: 0,
        ok: false,
      });
    }
    return saveLeagueData(leagueData, {
      source: `${diagnostics?.source || "cpu_trade_overlay"}:fallback_full`,
    });
  }

  try {
    await runStoreTransaction("readwrite", (store) => store.put(overlayRecord));
    updateStorageMarkers(leagueData, savedAt);
    writeLocalStoragePointerOnly(leagueData, savedAt);

    try {
      if (typeof window !== "undefined") {
        window.__leagueData = leagueData;
        window.__basketballManagerLeagueData = leagueData;
      }
    } catch {}

    diagnosticOk = true;
    return leagueData;
  } catch (error) {
    console.warn("[leagueStorage] CPU trade bank sidecar save failed. Falling back to a full league save.", error);
    return saveLeagueData(leagueData, {
      source: `${diagnostics?.source || "cpu_trade_overlay"}:fallback_full`,
    });
  } finally {
    if (diagnosticsEnabled) {
      const diagnosticEndedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      recordMultiYearStorageWrite({
        seasonYear: Number(leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.year ?? 0),
        mode: "bank_overlay",
        source: diagnostics?.source || "cpu_trade_overlay",
        durationMs: diagnosticEndedAt - diagnosticStartedAt,
        ok: diagnosticOk,
      });
    }
  }
}

export async function saveInjuryStateOverlay(leagueData, diagnostics = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  ensureLeagueStorageIdentity(leagueData);
  const diagnosticsEnabled = isMultiYearSpeedDiagnosticsEnabled();
  const diagnosticStartedAt = diagnosticsEnabled
    ? (typeof performance !== "undefined" ? performance.now() : Date.now())
    : 0;
  let diagnosticOk = false;
  const savedAt = Date.now();
  const overlayRecord = buildInjuryStateOverlayRecord(leagueData, savedAt);

  if (!overlayRecord) {
    if (diagnosticsEnabled) {
      recordMultiYearStorageWrite({
        seasonYear: Number(leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.year ?? 0),
        mode: "injury_overlay",
        source: diagnostics?.source || "injury_state_overlay",
        durationMs: 0,
        ok: false,
      });
    }
    return saveLeagueData(leagueData, {
      source: `${diagnostics?.source || "injury_state_overlay"}:fallback_full`,
    });
  }

  try {
    await runStoreTransaction("readwrite", (store) => store.put(overlayRecord));
    updateStorageMarkers(leagueData, savedAt);
    writeLocalStoragePointerOnly(leagueData, savedAt);

    try {
      if (typeof window !== "undefined") {
        window.__leagueData = leagueData;
        window.__basketballManagerLeagueData = leagueData;
      }
    } catch {}

    diagnosticOk = true;
    return leagueData;
  } catch (error) {
    console.warn("[leagueStorage] Injury-state sidecar save failed. Falling back to a full league save.", error);
    return saveLeagueData(leagueData, {
      source: `${diagnostics?.source || "injury_state_overlay"}:fallback_full`,
    });
  } finally {
    if (diagnosticsEnabled) {
      const diagnosticEndedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      recordMultiYearStorageWrite({
        seasonYear: Number(leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.year ?? 0),
        mode: "injury_overlay",
        source: diagnostics?.source || "injury_state_overlay",
        durationMs: diagnosticEndedAt - diagnosticStartedAt,
        ok: diagnosticOk,
      });
    }
  }
}

export async function loadLeagueData() {
  // 1. Load the full IndexedDB snapshot, then layer on any newer compatible
  // injury and CPU-trade sidecars. Sidecars never delete history; they only
  // restore the newest domain state that had not yet needed a full save.
  try {
    const [saved, cpuTradeOverlay, injuryOverlay] = await Promise.all([
      runStoreTransaction("readonly", (store) => store.get(ACTIVE_LEAGUE_KEY)),
      runStoreTransaction("readonly", (store) => store.get(CPU_TRADE_BANK_OVERLAY_KEY)),
      runStoreTransaction("readonly", (store) => store.get(INJURY_STATE_OVERLAY_KEY)),
    ]);

    if (leagueHasTeams(saved?.leagueData)) {
      const injuryMerged = mergeInjuryStateOverlayIntoLeague(saved.leagueData, saved, injuryOverlay);
      const cpuMerged = mergeCpuTradeBankOverlayIntoLeague(injuryMerged.leagueData, saved, cpuTradeOverlay);
      const loadedLeague = cpuMerged.leagueData;
      ensureLeagueStorageIdentity(loadedLeague);

      const savedAt = Date.now();
      updateStorageMarkers(loadedLeague, savedAt);
      writeLocalStoragePointerOnly(loadedLeague, savedAt);

      if (injuryOverlay && !injuryMerged.applied) {
        runStoreTransaction("readwrite", (store) => store.delete(INJURY_STATE_OVERLAY_KEY)).catch(() => {});
      }
      if (cpuTradeOverlay && !cpuMerged.applied) {
        runStoreTransaction("readwrite", (store) => store.delete(CPU_TRADE_BANK_OVERLAY_KEY)).catch(() => {});
      }

      try {
        if (typeof window !== "undefined") {
          window.__leagueData = loadedLeague;
          window.__basketballManagerLeagueData = loadedLeague;
        }
      } catch {}

      return loadedLeague;
    }
  } catch (err) {
    console.warn("[leagueStorage] IndexedDB v2 load failed. Trying fallbacks.", err);
  }

  // 2. Try old full localStorage leagueData, then migrate it to IndexedDB and shrink localStorage.
  const localLeague = readLeagueDataFromLocalStorage();
  if (leagueHasTeams(localLeague)) {
    saveLeagueData(localLeague).catch((err) => {
      console.warn("[leagueStorage] Could not migrate localStorage leagueData to IndexedDB v2.", err);
    });

    return localLeague;
  }

  // 3. Try legacy v1 IndexedDB only as a fallback.
  const legacyLeague = await readLeagueDataFromLegacyIndexedDB();
  if (leagueHasTeams(legacyLeague)) {
    saveLeagueData(legacyLeague).catch((err) => {
      console.warn("[leagueStorage] Could not migrate legacy IndexedDB leagueData to v2.", err);
    });

    return legacyLeague;
  }

  return null;
}

export async function migrateLeagueDataFromLocalStorage() {
  const loaded = await loadLeagueData();

  if (leagueHasTeams(loaded)) {
    await saveLeagueData(loaded);
  }

  return loaded;
}

export async function clearLeagueDataFromIndexedDB() {
  try {
    await runStoreTransaction("readwrite", (store) => {
      const request = store.delete(ACTIVE_LEAGUE_KEY);
      store.delete(CPU_TRADE_BANK_OVERLAY_KEY);
      store.delete(INJURY_STATE_OVERLAY_KEY);
      return request;
    });
  } catch (err) {
    console.warn("[leagueStorage] Could not clear IndexedDB leagueData.", err);
  }

  try {
    rawRemoveLocalStorageItem(STORAGE_MODE_KEY);
    rawRemoveLocalStorageItem(STORAGE_POINTER_KEY);
    rawRemoveLocalStorageItem(LAST_SAVED_KEY);
  } catch {}
}

export function saveLeagueDataInBackground(leagueData, diagnostics = {}) {
  saveLeagueData(leagueData, diagnostics).catch((err) => {
    console.error("[leagueStorage] Failed to save leagueData.", err);
  });
}

function installLeagueDataLocalStorageWriteGuard() {
  try {
    if (!hasLocalStorage()) return;
    if (typeof Storage === "undefined") return;

    const proto = Storage.prototype;
    if (proto.setItem?.__bmLeagueDataGuardInstalled) return;

    originalLocalStorageSetItem = proto.setItem;

    const guardedSetItem = function guardedSetItem(key, value) {
      if (String(key) !== "leagueData") {
        return originalLocalStorageSetItem.call(this, key, value);
      }

      const parsed = safeJsonParse(value, null);

      if (leagueHasTeams(parsed)) {
        const savedAt = Date.now();
        const pointer = buildStoragePointer(parsed, savedAt);

        // Never let a full league save hit localStorage, even while an
        // IndexedDB save is already in progress. This prevents quota crashes
        // from pages that still call localStorage.setItem("leagueData", ...).
        originalLocalStorageSetItem.call(this, key, JSON.stringify(pointer));
        updateStorageMarkers(parsed, savedAt);

        try {
          if (typeof window !== "undefined") {
            window.__leagueData = parsed;
            window.__basketballManagerLeagueData = parsed;
          }
        } catch {}

        if (!leagueDataSaveInProgress) {
          saveLeagueData(parsed).catch((err) => {
            console.warn("[leagueStorage] Redirected direct leagueData localStorage write could not save to IndexedDB.", err);
            try {
              writeLocalStorageFallbackMirror(parsed);
            } catch {}
          });
        }

        return;
      }

      return originalLocalStorageSetItem.call(this, key, value);
    };

    Object.defineProperty(guardedSetItem, "__bmLeagueDataGuardInstalled", {
      value: true,
      enumerable: false,
    });

    proto.setItem = guardedSetItem;
  } catch (err) {
    console.warn("[leagueStorage] Could not install localStorage leagueData guard.", err);
  }
}

installLeagueDataLocalStorageWriteGuard();
