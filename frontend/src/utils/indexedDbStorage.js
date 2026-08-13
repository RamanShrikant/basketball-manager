// src/utils/indexedDbStorage.js
// Larger browser storage for Basketball Manager save data.
// localStorage stays for small/fast summaries. IndexedDB stores heavy full box scores.

const DB_NAME = "basketball_manager_storage_v1";
const BOX_SCORE_STORE = "boxScores";
const APP_DATA_STORE = "appData";

let dbPromise = null;

function ensureBoxScoreStore(db) {
  if (!db.objectStoreNames.contains(BOX_SCORE_STORE)) {
    const store = db.createObjectStore(BOX_SCORE_STORE, {
      keyPath: "gameId",
    });

    store.createIndex("updatedAt", "updatedAt", { unique: false });
    store.createIndex("seasonYear", "seasonYear", { unique: false });
  }
}

function ensureAppDataStore(db) {
  if (!db.objectStoreNames.contains(APP_DATA_STORE)) {
    const store = db.createObjectStore(APP_DATA_STORE, {
      keyPath: "key",
    });
    store.createIndex("updatedAt", "updatedAt", { unique: false });
  }
}

function ensureRequiredStores(db) {
  ensureBoxScoreStore(db);
  ensureAppDataStore(db);
}

function hasRequiredStores(db) {
  return (
    db.objectStoreNames.contains(BOX_SCORE_STORE) &&
    db.objectStoreNames.contains(APP_DATA_STORE)
  );
}

function openBasketballManagerDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const fail = (error) => {
      dbPromise = null;
      reject(error || new Error("Failed to open IndexedDB."));
    };

    const finishOpen = (db) => {
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      if (!hasRequiredStores(db)) {
        const nextVersion = Math.max(1, Number(db.version || 1) + 1);
        db.close();

        const upgradeRequest = indexedDB.open(DB_NAME, nextVersion);
        upgradeRequest.onupgradeneeded = () => {
          ensureRequiredStores(upgradeRequest.result);
        };
        upgradeRequest.onsuccess = () => {
          const upgradedDb = upgradeRequest.result;
          upgradedDb.onversionchange = () => {
            upgradedDb.close();
            dbPromise = null;
          };

          if (!hasRequiredStores(upgradedDb)) {
            upgradedDb.close();
            fail(new Error("IndexedDB required object stores are missing after upgrade."));
            return;
          }

          resolve(upgradedDb);
        };
        upgradeRequest.onerror = () => fail(upgradeRequest.error);
        upgradeRequest.onblocked = () => {
          console.warn("[indexedDbStorage] IndexedDB upgrade is blocked by another tab. Close other tabs and refresh.");
        };
        return;
      }

      resolve(db);
    };

    // Open the browser's existing DB version instead of hard-coding an older
    // version. This avoids VersionError when a user's DB has already advanced.
    const request = indexedDB.open(DB_NAME);

    request.onupgradeneeded = () => {
      // Brand-new databases need every current store on first creation.
      ensureRequiredStores(request.result);
    };

    request.onsuccess = () => finishOpen(request.result);
    request.onerror = () => fail(request.error);
    request.onblocked = () => {
      console.warn("[indexedDbStorage] IndexedDB open is blocked by another tab. Close other tabs and refresh.");
    };
  });

  return dbPromise;
}

function runTransaction(storeName, mode, callback) {
  return openBasketballManagerDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let tx;
        let store;
        let callbackResult;

        try {
          if (!db.objectStoreNames.contains(storeName)) {
            dbPromise = null;
            reject(new Error(`IndexedDB object store not found: ${storeName}`));
            return;
          }

          tx = db.transaction(storeName, mode);
          store = tx.objectStore(storeName);
          callbackResult = callback(store, tx);
        } catch (err) {
          reject(err);
          return;
        }

        tx.oncomplete = () => resolve(callbackResult);
        tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
      })
  );
}

export async function saveBoxScoreToDB(gameId, result, meta = {}) {
  if (!gameId || !result) return false;

  await runTransaction(BOX_SCORE_STORE, "readwrite", (store) => {
    store.put({
      gameId,
      result,
      seasonYear: meta.seasonYear ?? null,
      home: meta.home ?? null,
      away: meta.away ?? null,
      updatedAt: Date.now(),
    });
  });

  return true;
}

export async function saveBoxScoresBatchToDB(rows = []) {
  const cleanRows = (rows || []).filter((row) => row?.gameId && row?.result);
  if (!cleanRows.length) return false;
  const updatedAt = Date.now();
  await runTransaction(BOX_SCORE_STORE, "readwrite", (store) => {
    for (const row of cleanRows) {
      store.put({
        gameId: row.gameId,
        result: row.result,
        seasonYear: row?.seasonYear ?? null,
        home: row?.home ?? null,
        away: row?.away ?? null,
        updatedAt,
      });
    }
  });
  return true;
}

export async function loadBoxScoreFromDB(gameId) {
  if (!gameId) return null;

  const db = await openBasketballManagerDb();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(BOX_SCORE_STORE, "readonly");
      const store = tx.objectStore(BOX_SCORE_STORE);
      const request = store.get(gameId);

      request.onsuccess = () => {
        const row = request.result;
        resolve(row?.result || null);
      };

      request.onerror = () => reject(request.error || new Error("Failed to load box score."));
    } catch (err) {
      reject(err);
    }
  });
}

export async function loadBoxScoresByGameIdsFromDB(gameIds = []) {
  const ids = [...new Set((gameIds || []).filter(Boolean).map((id) => String(id)))];
  if (!ids.length) return {};

  const db = await openBasketballManagerDb();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(BOX_SCORE_STORE, "readonly");
      const store = tx.objectStore(BOX_SCORE_STORE);
      const results = {};
      let remaining = ids.length;

      const finishOne = () => {
        remaining -= 1;
        if (remaining <= 0) resolve(results);
      };

      for (const gameId of ids) {
        const request = store.get(gameId);
        request.onsuccess = () => {
          const row = request.result;
          if (row?.result) results[gameId] = row.result;
          finishOne();
        };
        request.onerror = () => {
          console.warn("[indexedDbStorage] failed loading box score during batch", gameId, request.error);
          finishOne();
        };
      }

      tx.onerror = () => reject(tx.error || new Error("Failed to load box-score batch."));
      tx.onabort = () => reject(tx.error || new Error("Box-score batch read was aborted."));
    } catch (err) {
      reject(err);
    }
  });
}

export async function deleteBoxScoreFromDB(gameId) {
  if (!gameId) return false;

  await runTransaction(BOX_SCORE_STORE, "readwrite", (store) => {
    store.delete(gameId);
  });

  return true;
}

export async function clearBoxScoresFromDB() {
  await runTransaction(BOX_SCORE_STORE, "readwrite", (store) => {
    store.clear();
  });

  return true;
}

export async function countBoxScoresInDB() {
  const db = await openBasketballManagerDb();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(BOX_SCORE_STORE, "readonly");
      const store = tx.objectStore(BOX_SCORE_STORE);
      const request = store.count();

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error || new Error("Failed to count box scores."));
    } catch (err) {
      reject(err);
    }
  });
}


// ------------------------------------------------------------
// GENERIC LARGE APP DATA
// ------------------------------------------------------------
// Heavy, growing UI/domain payloads belong here instead of localStorage.
// Values are stored as structured-clone data, so callers avoid JSON stringify
// quota pressure on the main thread.
export async function saveAppDataToDB(key, value) {
  if (!key) return false;

  await runTransaction(APP_DATA_STORE, "readwrite", (store) => {
    store.put({
      key: String(key),
      value,
      updatedAt: Date.now(),
    });
  });

  return true;
}

export async function loadAppDataFromDB(key) {
  if (!key) return null;
  const db = await openBasketballManagerDb();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(APP_DATA_STORE, "readonly");
      const store = tx.objectStore(APP_DATA_STORE);
      const request = store.get(String(key));

      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error || new Error("Failed to load app data."));
    } catch (err) {
      reject(err);
    }
  });
}

export async function deleteAppDataFromDB(key) {
  if (!key) return false;
  await runTransaction(APP_DATA_STORE, "readwrite", (store) => {
    store.delete(String(key));
  });
  return true;
}

export async function clearAppDataFromDB() {
  await runTransaction(APP_DATA_STORE, "readwrite", (store) => {
    store.clear();
  });
  return true;
}
