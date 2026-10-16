// Prevent simultaneous tabs from writing different accounts into the same
// existing un-namespaced game databases. Lock lasts until the document closes.
let acquirePromise;
export function acquireAccountGameLock() {
  if (acquirePromise) return acquirePromise;
  if (!navigator.locks?.request) {
    return Promise.reject(new Error("Account switching requires a recent browser with Web Locks support (Chrome or Edge)."));
  }
  acquirePromise = new Promise((resolve, reject) => {
    navigator.locks.request("bm-account-active-game-v1", { mode: "exclusive", ifAvailable: true }, lock => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise(() => {});
    }).catch(reject);
  });
  return acquirePromise;
}
