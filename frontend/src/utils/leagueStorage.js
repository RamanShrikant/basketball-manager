const DB_NAME = "basketball_manager_league_storage_v2";
const DB_VERSION = 1;
const STORE_NAME = "league_saves";
const ACTIVE_LEAGUE_KEY = "active_league";

const LEGACY_DB_NAMES = [
  "basketball_manager_storage_v1",
];

const STORAGE_MODE_KEY = "leagueDataStorageMode";
const STORAGE_POINTER_KEY = "leagueDataIndexedDbPointer";
const LAST_SAVED_KEY = "leagueDataLastSavedAt";

function hasIndexedDB() {
  return typeof indexedDB !== "undefined";
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

      // Extra guard:
      // If a browser somehow opens the DB without the store, fail cleanly so
      // the app can fall back to localStorage instead of crashing.
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

      if (leagueHasTeams(legacy)) {
        return legacy;
      }
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

function buildLocalStorageMirror(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const mirror = {
    ...leagueData,
    freeAgencyState: compactFreeAgencyStateForMirror(leagueData.freeAgencyState),
    __storageMode: "indexedDB_mirror",
    __indexedDbKey: ACTIVE_LEAGUE_KEY,
    __indexedDbDbName: DB_NAME,
    __mirrorSavedAt: Date.now(),
  };

  delete mirror.fullActionLog;
  delete mirror.freeAgencyDebugErrors;

  return mirror;
}

function writeLocalStoragePointerOnly(leagueData = null) {
  try {
    const pointer = {
      __storageMode: "indexedDB",
      __indexedDbKey: ACTIVE_LEAGUE_KEY,
      __indexedDbDbName: DB_NAME,
      seasonYear: leagueData?.seasonYear || leagueData?.currentSeasonYear || null,
      savedAt: Date.now(),
    };

    localStorage.setItem("leagueData", JSON.stringify(pointer));
  } catch {
    // Nothing else to do. IndexedDB remains the real save.
  }
}

function updateStorageMarkers(leagueData = null) {
  try {
    const savedAt = Date.now();
    localStorage.setItem(STORAGE_MODE_KEY, "indexedDB");
    localStorage.setItem(LAST_SAVED_KEY, String(savedAt));
    localStorage.setItem(
      STORAGE_POINTER_KEY,
      JSON.stringify({
        dbName: DB_NAME,
        storeName: STORE_NAME,
        key: ACTIVE_LEAGUE_KEY,
        savedAt,
        seasonYear: leagueData?.seasonYear || leagueData?.currentSeasonYear || null,
      })
    );
  } catch {
    // Markers are helpful, but not required.
  }
}

function writeLocalStorageMirror(leagueData) {
  const mirror = buildLocalStorageMirror(leagueData);

  try {
    localStorage.setItem("leagueData", JSON.stringify(mirror));
  } catch (err) {
    console.warn("[leagueStorage] Local mirror was too large. Falling back to pointer only.", err);
    try {
      localStorage.removeItem("leagueData");
    } catch {}
    writeLocalStoragePointerOnly(leagueData);
  }
}

export async function saveLeagueData(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  try {
    await runStoreTransaction("readwrite", (store) =>
      store.put({
        id: ACTIVE_LEAGUE_KEY,
        leagueData,
        updatedAt: Date.now(),
        version: 2,
      })
    );

    updateStorageMarkers(leagueData);
    writeLocalStorageMirror(leagueData);
    return leagueData;
  } catch (err) {
    console.error("[leagueStorage] IndexedDB save failed. Falling back to compact localStorage mirror.", err);

    // Last-resort fallback so old browsers or private-mode failures do not
    // make the whole app unusable.
    writeLocalStorageMirror(leagueData);
    return leagueData;
  }
}

export async function loadLeagueData() {
  // 1. Try the clean v2 IndexedDB save first.
  try {
    const saved = await runStoreTransaction("readonly", (store) =>
      store.get(ACTIVE_LEAGUE_KEY)
    );

    if (leagueHasTeams(saved?.leagueData)) {
      updateStorageMarkers(saved.leagueData);
      return saved.leagueData;
    }
  } catch (err) {
    console.warn("[leagueStorage] IndexedDB v2 load failed. Trying fallbacks.", err);
  }

  // 2. Try old localStorage leagueData.
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
    await runStoreTransaction("readwrite", (store) => store.delete(ACTIVE_LEAGUE_KEY));
  } catch (err) {
    console.warn("[leagueStorage] Could not clear IndexedDB leagueData.", err);
  }

  try {
    localStorage.removeItem(STORAGE_MODE_KEY);
    localStorage.removeItem(STORAGE_POINTER_KEY);
    localStorage.removeItem(LAST_SAVED_KEY);
  } catch {}
}

export function saveLeagueDataInBackground(leagueData) {
  saveLeagueData(leagueData).catch((err) => {
    console.error("[leagueStorage] Failed to save leagueData.", err);
  });
}
