// Online-only UI preference shim: strictly in memory; cannot access SP browser saves.
// Never expose IndexedDB, localStorage, sessionStorage, or a write-through API here.
const values = new Map();
export const onlineInertStorage = Object.freeze({
  get length() { return values.size; },
  getItem(key) { const k=String(key); return values.has(k) ? values.get(k) : null; },
  setItem(key,value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); },
  key(index) { return [...values.keys()][index] ?? null; },
});
