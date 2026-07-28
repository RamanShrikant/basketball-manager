export const CPU_TRADE_TELEMETRY_VERSION = "2026-07-28_speed_v5b_parallel_generation";

const MAX_TIMING_SAMPLES = 600;
const MAX_EVENT_ROWS = 500;
const MAX_VALIDATION_SIGNATURES = 400;
const MAX_BENCHMARK_SAMPLES = 12;

function nowMs() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value) {
  return Math.round(finiteNumber(value, 0) * 1000) / 1000;
}

function safeClone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function makeMetric() {
  return {
    count: 0,
    totalMs: 0,
    minMs: null,
    maxMs: 0,
    samples: [],
  };
}

function makeState() {
  return {
    version: CPU_TRADE_TELEMETRY_VERSION,
    sessionKey: "",
    sessionStartedAt: nowIso(),
    suppressedDepth: 0,
    metrics: {},
    counters: {},
    validationBySignature: {},
    validationEvents: [],
    benchmarkSamples: [],
    generationJobs: [],
    passes: [],
    bankHealth: [],
    repairs: [],
    completedTrades: [],
    feedWrites: [],
    storageWrites: [],
    baseline: null,
    lastContext: null,
    notes: [],
  };
}

let state = makeState();

function metricFor(name) {
  if (!state.metrics[name]) state.metrics[name] = makeMetric();
  return state.metrics[name];
}

function pushBounded(list, row, max = MAX_EVENT_ROWS) {
  list.push(row);
  if (list.length > max) list.splice(0, list.length - max);
}

function itemTypeCounts(candidate = {}) {
  const fromItems = Array.isArray(candidate?.fromItems) ? candidate.fromItems : [];
  const toItems = Array.isArray(candidate?.toItems) ? candidate.toItems : [];
  const all = [...fromItems, ...toItems];
  const fromPlayers = fromItems.filter((item) => item?.type === "player").length;
  const toPlayers = toItems.filter((item) => item?.type === "player").length;
  const picks = all.filter((item) => item?.type === "pick").length;
  return {
    fromPlayers,
    toPlayers,
    picks,
    assets: all.length,
    shape: `${fromPlayers}v${toPlayers}${picks ? `+${picks}pick` : ""}`,
  };
}

function teamViewSummary(view = null) {
  if (!view || typeof view !== "object") return null;
  const threshold = finiteNumber(view?.teamImpact?.threshold ?? view?.threshold, 0);
  const score = finiteNumber(view?.score, 0);
  return {
    accepted: Boolean(view?.accepted || ["accept", "accepted"].includes(String(view?.decision || "").toLowerCase())),
    decision: view?.decision || "",
    score: round3(score),
    threshold: round3(threshold),
    margin: round3(score - threshold),
  };
}

function validationSummary(result = {}) {
  return {
    ok: Boolean(result?.ok),
    staleCode: result?.staleCode || null,
    reason: result?.reason || result?.message || "",
    requiresRosterRepairBeforeSimulation: Boolean(result?.requiresRosterRepairBeforeSimulation),
    fromTeamView: teamViewSummary(result?.fromTeamView),
    toTeamView: teamViewSummary(result?.toTeamView),
    combinedScore: round3(result?.evaluation?.score || 0),
  };
}

function sampleCategory(candidate = {}, result = {}) {
  const counts = itemTypeCounts(candidate);
  if (!result?.ok) return "rejected";
  if (counts.picks > 0 || counts.assets > 2 || result?.requiresRosterRepairBeforeSimulation) return "complex";
  if (counts.fromPlayers === 1 && counts.toPlayers === 1) return "simple";
  return "accepted_other";
}

function maybeCaptureBenchmarkSample({ signature, phase, candidate, leagueData, context, result }) {
  if (!signature || !candidate || !leagueData) return;
  const category = sampleCategory(candidate, result);
  if (!["simple", "rejected", "complex"].includes(category)) return;
  if (state.benchmarkSamples.some((row) => row.category === category)) return;
  if (state.benchmarkSamples.length >= MAX_BENCHMARK_SAMPLES) return;

  const captureStartedAt = nowMs();
  const candidateSnapshot = safeClone(candidate);
  const leagueSnapshot = safeClone(leagueData);
  if (!candidateSnapshot || !leagueSnapshot) return;

  state.benchmarkSamples.push({
    category,
    signature,
    phase,
    candidate: candidateSnapshot,
    leagueData: leagueSnapshot,
    context: safeClone(context || {}),
    expected: validationSummary(result),
    capturedAt: nowIso(),
    package: itemTypeCounts(candidateSnapshot),
  });

  recordCpuTradeTiming("benchmarkCaptureMs", nowMs() - captureStartedAt, {
    category,
    signature,
  });
}

export function resetCpuTradeTelemetry({ sessionKey = "", note = "manual_reset" } = {}) {
  state = makeState();
  state.sessionKey = String(sessionKey || "");
  state.notes.push({ at: nowIso(), note });
  return getCpuTradeTelemetryState();
}

export function ensureCpuTradeTelemetrySession(sessionKey = "", metadata = {}) {
  const resolvedKey = String(sessionKey || "");
  if (resolvedKey && state.sessionKey && state.sessionKey !== resolvedKey) {
    resetCpuTradeTelemetry({ sessionKey: resolvedKey, note: "session_key_changed" });
  } else if (resolvedKey && !state.sessionKey) {
    state.sessionKey = resolvedKey;
  }
  state.lastContext = {
    ...(state.lastContext || {}),
    ...safeClone(metadata || {}),
    touchedAt: nowIso(),
  };
  return getCpuTradeTelemetryState();
}

export function setCpuTradeTelemetryBaseline(baseline = {}) {
  if (!state.baseline) {
    state.baseline = {
      ...baseline,
      capturedAt: baseline?.capturedAt || nowIso(),
    };
  }
  return state.baseline;
}

export function getCpuTradeTelemetryBaseline() {
  return state.baseline;
}

export function cpuTradeNow() {
  return nowMs();
}

export function recordCpuTradeTiming(name, durationMs, details = null) {
  if (state.suppressedDepth > 0) return null;
  const value = Math.max(0, finiteNumber(durationMs, 0));
  const metric = metricFor(String(name || "unknown"));
  metric.count += 1;
  metric.totalMs = round3(metric.totalMs + value);
  metric.minMs = metric.minMs === null ? round3(value) : round3(Math.min(metric.minMs, value));
  metric.maxMs = round3(Math.max(metric.maxMs, value));
  metric.samples.push(round3(value));
  if (metric.samples.length > MAX_TIMING_SAMPLES) {
    metric.samples.splice(0, metric.samples.length - MAX_TIMING_SAMPLES);
  }
  if (details) metric.lastDetails = safeClone(details);
  return value;
}

export function incrementCpuTradeCounter(name, amount = 1) {
  if (state.suppressedDepth > 0) return 0;
  const key = String(name || "unknown");
  state.counters[key] = finiteNumber(state.counters[key], 0) + finiteNumber(amount, 0);
  return state.counters[key];
}

export function recordCpuTradeValidation({
  phase = "unknown",
  signature = "",
  candidate = null,
  leagueData = null,
  context = null,
  result = null,
  durationMs = 0,
} = {}) {
  if (state.suppressedDepth > 0) return null;
  const key = String(signature || "unknown");
  const summary = validationSummary(result || {});
  const packageInfo = itemTypeCounts(candidate || {});
  const existing = state.validationBySignature[key] || {
    signature: key,
    count: 0,
    accepted: 0,
    rejected: 0,
    totalMs: 0,
    minMs: null,
    maxMs: 0,
    phases: {},
    package: packageInfo,
    teams: [candidate?.fromTeamName || "", candidate?.toTeamName || ""].filter(Boolean),
  };
  existing.count += 1;
  existing.accepted += summary.ok ? 1 : 0;
  existing.rejected += summary.ok ? 0 : 1;
  existing.totalMs = round3(existing.totalMs + finiteNumber(durationMs, 0));
  existing.minMs = existing.minMs === null
    ? round3(durationMs)
    : round3(Math.min(existing.minMs, finiteNumber(durationMs, 0)));
  existing.maxMs = round3(Math.max(existing.maxMs, finiteNumber(durationMs, 0)));
  existing.phases[phase] = finiteNumber(existing.phases[phase], 0) + 1;
  existing.lastResult = summary;
  existing.lastDate = context?.currentDate || context?.generatedDate || "";
  state.validationBySignature[key] = existing;

  const keys = Object.keys(state.validationBySignature);
  if (keys.length > MAX_VALIDATION_SIGNATURES) {
    const removable = keys
      .map((signatureKey) => state.validationBySignature[signatureKey])
      .sort((a, b) => finiteNumber(a.count, 0) - finiteNumber(b.count, 0))
      .slice(0, keys.length - MAX_VALIDATION_SIGNATURES);
    for (const row of removable) delete state.validationBySignature[row.signature];
  }

  pushBounded(state.validationEvents, {
    phase,
    signature: key,
    durationMs: round3(durationMs),
    date: context?.currentDate || context?.generatedDate || "",
    package: packageInfo,
    result: summary,
    recordedAt: nowIso(),
  });

  maybeCaptureBenchmarkSample({ signature: key, phase, candidate, leagueData, context, result });
  return existing;
}

export function recordCpuTradeGenerationJob(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.generationJobs, row, 250);
  return row;
}

export function recordCpuTradePass(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.passes, row, 400);
  return row;
}

export function recordCpuTradeBankHealth(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.bankHealth, row, 400);
  return row;
}

export function recordCpuTradeRepair(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.repairs, row, 120);
  return row;
}

export function recordCpuTradeCompleted(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.completedTrades, row, 120);
  return row;
}

export function recordCpuTradeFeedWrite(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.feedWrites, row, 250);
  return row;
}

export function recordCpuTradeStorageWrite(payload = {}) {
  if (state.suppressedDepth > 0) return null;
  const row = { ...safeClone(payload), recordedAt: nowIso() };
  pushBounded(state.storageWrites, row, 250);
  return row;
}

export function getCpuTradeTelemetryState() {
  return state;
}

export function getCpuTradeTelemetrySnapshot() {
  const validationBySignature = Object.values(state.validationBySignature).map((row) => ({ ...row }));
  return {
    version: state.version,
    sessionKey: state.sessionKey,
    sessionStartedAt: state.sessionStartedAt,
    metrics: safeClone(state.metrics),
    counters: safeClone(state.counters),
    validationBySignature,
    validationEvents: safeClone(state.validationEvents),
    benchmarkSamples: state.benchmarkSamples.map((row) => ({
      category: row.category,
      signature: row.signature,
      phase: row.phase,
      context: safeClone(row.context),
      expected: safeClone(row.expected),
      capturedAt: row.capturedAt,
      package: safeClone(row.package),
    })),
    generationJobs: safeClone(state.generationJobs),
    passes: safeClone(state.passes),
    bankHealth: safeClone(state.bankHealth),
    repairs: safeClone(state.repairs),
    completedTrades: safeClone(state.completedTrades),
    feedWrites: safeClone(state.feedWrites),
    storageWrites: safeClone(state.storageWrites),
    baseline: safeClone(state.baseline),
    lastContext: safeClone(state.lastContext),
    notes: safeClone(state.notes),
  };
}

export function getCpuTradeBenchmarkSamples() {
  return state.benchmarkSamples;
}

export function withCpuTradeTelemetrySuppressed(callback) {
  state.suppressedDepth += 1;
  try {
    return callback();
  } finally {
    state.suppressedDepth = Math.max(0, state.suppressedDepth - 1);
  }
}
