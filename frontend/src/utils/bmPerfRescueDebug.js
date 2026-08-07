const DEBUG_KEY = "bm_perf_debug_v1";

function debugEnabled() {
  try {
    return Boolean(
      (typeof window !== "undefined" && window.__BM_PERF_RESCUE_ENABLED) ||
        (typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_KEY) === "1")
    );
  } catch {
    return false;
  }
}

function ensurePerfObject() {
  if (typeof window === "undefined") return null;
  if (!window.BM_PERF || typeof window.BM_PERF !== "object") {
    window.BM_PERF = {
      counters: {},
      samples: [],
      reset() {
        this.counters = {};
        this.samples = [];
        return this.counters;
      },
      dump() {
        try { console.table(this.counters || {}); } catch {}
        return { counters: { ...(this.counters || {}) }, samples: [...(this.samples || [])] };
      },
    };
  } else {
    window.BM_PERF.counters = window.BM_PERF.counters || {};
    window.BM_PERF.samples = window.BM_PERF.samples || [];
    if (typeof window.BM_PERF.reset !== "function") {
      window.BM_PERF.reset = function reset() {
        this.counters = {};
        this.samples = [];
        return this.counters;
      };
    }
    if (typeof window.BM_PERF.dump !== "function") {
      window.BM_PERF.dump = function dump() {
        try { console.table(this.counters || {}); } catch {}
        return { counters: { ...(this.counters || {}) }, samples: [...(this.samples || [])] };
      };
    }
  }
  return window.BM_PERF;
}

export function bumpPerfCounter(name, amount = 1, sample = null) {
  if (!debugEnabled() || !name) return;
  try {
    const perf = ensurePerfObject();
    if (!perf) return;
    perf.counters[name] = Number(perf.counters[name] || 0) + Number(amount || 1);
    if (sample && perf.samples.length < 250) {
      perf.samples.push({ name, at: Date.now(), ...sample });
    }
  } catch {}
}

export function timePerfCounter(name, startedAt, sample = null) {
  if (!debugEnabled() || !name) return;
  const elapsed = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  bumpPerfCounter(`${name}.calls`, 1, sample);
  bumpPerfCounter(`${name}.ms`, elapsed);
}


export function ensureBmPerfGlobal() {
  return ensurePerfObject();
}

try {
  ensurePerfObject();
} catch {}
