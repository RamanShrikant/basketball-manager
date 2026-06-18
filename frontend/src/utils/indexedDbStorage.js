// src/utils/indexedDbStorage.js
// Larger browser storage for Basketball Manager save data.
// localStorage stays for small/fast summaries. IndexedDB stores heavy full box scores.

const DB_NAME = "basketball_manager_storage_v1";
// Bump to v2 so browsers that already created v1 with zero stores run onupgradeneeded.
const DB_VERSION = 2;
const BOX_SCORE_STORE = "boxScores";

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

function openBasketballManagerDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      ensureBoxScoreStore(db);
    };

    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(BOX_SCORE_STORE)) {
        db.close();
        dbPromise = null;
        reject(
          new Error(
            `IndexedDB object store missing after open: ${BOX_SCORE_STORE}. Close other tabs and refresh.`
          )
        );
        return;
      }

      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("Failed to open IndexedDB."));
    };

    request.onblocked = () => {
      console.warn("[indexedDbStorage] IndexedDB upgrade is blocked by another tab. Close other tabs and refresh.");
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
