// Only for restoring a cloud snapshot on a completely new browser.
// Do not alter existing databases; the existing game owns upgrades and indexes.
const KNOWN_SCHEMAS = {
  basketball_manager_storage_v1: {
    boxScores: { keyPath: "gameId", indexes: ["updatedAt", "seasonYear"] },
    appData: { keyPath: "key", indexes: ["updatedAt"] },
  },
  basketball_manager_league_storage_v2: {
    league_saves: { keyPath: "id", indexes: [] },
  },
  basketball_manager_local_save_slots_v1: {
    leagueSaves: { keyPath: "saveId", indexes: ["updatedAt", "leagueName"] },
  },
};

function openFreshDatabase(name, stores) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [storeName, schema] of Object.entries(stores)) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const store = db.createObjectStore(storeName, { keyPath: schema.keyPath });
        for (const indexName of schema.indexes) {
          store.createIndex(indexName, indexName, { unique: false });
        }
      }
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error || new Error(`Couldn't prepare ${name}`));
    req.onblocked = () => reject(new Error("Close other Basketball Manager tabs before restoring cloud saves."));
  });
}

export async function prepareCloudRestoreDatabases(snapshot) {
  if (typeof indexedDB?.databases !== "function") throw new Error("Browser requires IndexedDB.databases support.");
  const existing = new Set((await indexedDB.databases()).map(x => x.name));
  for (const name of Object.keys(snapshot?.dbs || {})) {
    if (!Object.hasOwn(KNOWN_SCHEMAS, name)) throw new Error(`Unknown game database in cloud snapshot: ${name}`);
    const requiredStores = Object.keys(snapshot.dbs[name]?.stores || {});
    for (const store of requiredStores) {
      if (!Object.hasOwn(KNOWN_SCHEMAS[name], store)) throw new Error(`Unknown storage table in cloud snapshot: ${name}/${store}`);
    }
    if (!existing.has(name)) await openFreshDatabase(name, KNOWN_SCHEMAS[name]);
  }
}
