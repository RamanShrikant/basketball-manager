// src/utils/indexedDbStorage.js
// Larger browser storage for Basketball Manager save data.
// localStorage stays for small/fast summaries. IndexedDB stores heavy full box scores.

const DB_NAME = "basketball_manager_storage_v1";
const DB_VERSION = 1;
const BOX_SCORE_STORE = "boxScores";

let dbPromise = null;

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

      if (!db.objectStoreNames.contains(BOX_SCORE_STORE)) {
        const store = db.createObjectStore(BOX_SCORE_STORE, {
          keyPath: "gameId",
        });

        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("seasonYear", "seasonYear", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
  });

  return dbPromise;
}

function runTransaction(storeName, mode, callback) {
  return openBasketballManagerDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let callbackResult;

        tx.oncomplete = () => resolve(callbackResult);
        tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));

        try {
          callbackResult = callback(store, tx);
        } catch (err) {
          try {
            tx.abort();
          } catch {}
          reject(err);
        }
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
    const tx = db.transaction(BOX_SCORE_STORE, "readonly");
    const store = tx.objectStore(BOX_SCORE_STORE);
    const request = store.get(gameId);

    request.onsuccess = () => {
      const row = request.result;
      resolve(row?.result || null);
    };

    request.onerror = () => reject(request.error || new Error("Failed to load box score."));
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
    const tx = db.transaction(BOX_SCORE_STORE, "readonly");
    const store = tx.objectStore(BOX_SCORE_STORE);
    const request = store.count();

    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error || new Error("Failed to count box scores."));
  });
}