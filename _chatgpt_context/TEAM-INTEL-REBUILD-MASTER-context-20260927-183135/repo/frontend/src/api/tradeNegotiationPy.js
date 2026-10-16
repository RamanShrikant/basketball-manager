// tradeNegotiationPy.js
// Small dedicated API wrapper for CPU trade negotiation.
// Uses /public/workers/tradeWorker.js and /public/python/*.py.
//
// Public functions:
// - evaluateTradeProposal(proposal): Trade Builder exact accept/counter/reject.
// - findTradeOffers(search): Trade Finder offers using the same Python CPU logic.

let worker = null;
let counter = 0;
const pending = new Map();

/**
 * Safely clone values before sending them to the Pyodide worker.
 *
 * IMPORTANT:
 * The old version used a WeakSet and returned null for any repeated object
 * reference. In Trade Finder, selectedItems.player is the SAME object reference
 * as the player inside selectedTeam/teams. That caused selectedItems players to
 * become null before reaching Python, so Python saw targetValue = 0 and returned
 * "Add at least one player or pick before searching."
 *
 * This version uses a WeakMap clone cache instead. Repeated references now point
 * to the same sanitized clone instead of becoming null.
 */
function deepSanitize(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "function" || t === "symbol" || t === "bigint") return null;

  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);

    const out = [];
    seen.set(value, out);

    for (const item of value) {
      out.push(deepSanitize(item, seen));
    }

    return out;
  }

  if (t === "object") {
    if (seen.has(value)) return seen.get(value);

    const out = {};
    seen.set(value, out);

    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("__react") || key === "_reactInternals") continue;
      out[key] = deepSanitize(item, seen);
    }

    return out;
  }

  return null;
}

function startWorker() {
  if (worker) return;

  worker = new Worker("/workers/tradeWorker.js");

  worker.onmessage = (event) => {
    const msg = event.data || {};

    if (msg.type === "trade-evaluate-result" || msg.type === "trade-find-offers-result") {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      entry.resolve(msg.payload || null);
      return;
    }

    if (msg.type === "trade-evaluate-error" || msg.type === "trade-find-offers-error") {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      entry.reject(new Error(msg.error || "Trade CPU worker failed"));
    }
  };

  worker.onerror = (error) => {
    console.error("[tradeNegotiationPy] worker error", error);
  };
}

function requestFromWorker({ type, payloadKey, payload, timeoutMs = 30000 }) {
  startWorker();

  const requestId = `TRD${counter++}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("TRADE_CPU_TIMEOUT"));
    }, timeoutMs);

    pending.set(requestId, {
      resolve,
      reject,
      timer,
    });

    worker.postMessage({
      type,
      requestId,
      [payloadKey]: deepSanitize(payload),
    });
  });
}

export function evaluateTradeProposal(proposal = {}) {
  return requestFromWorker({
    type: "trade-evaluate",
    payloadKey: "proposal",
    payload: proposal,
    timeoutMs: 30000,
  });
}

export function findTradeOffers(search = {}) {
  return requestFromWorker({
    type: "trade-find-offers",
    payloadKey: "search",
    payload: search,
    timeoutMs: 45000,
  });
}
