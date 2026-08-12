const STORAGE_KEY = "bm_multi_year_speed_diag_v1";
const DIAGNOSTICS_VERSION = "2026-08-10_y1_y3_speed_baseline_v1";

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round3(value) {
  return Math.round(finite(value, 0) * 1000) / 1000;
}

function safeClone(value) {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }
}

function seasonYearOf(leagueData = {}, fallback = 0) {
  return finite(
    leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.year,
    fallback
  );
}

function makeMetric() {
  return { count: 0, totalMs: 0, maxMs: 0, minMs: null };
}

function addMetric(metric, value) {
  const ms = Math.max(0, finite(value, 0));
  metric.count += 1;
  metric.totalMs += ms;
  metric.maxMs = Math.max(metric.maxMs, ms);
  metric.minMs = metric.minMs === null ? ms : Math.min(metric.minMs, ms);
}

function finalizeMetric(metric = {}) {
  const count = finite(metric.count, 0);
  return {
    count,
    totalMs: round3(metric.totalMs),
    averageMs: count ? round3(metric.totalMs / count) : 0,
    maxMs: round3(metric.maxMs),
    minMs: count ? round3(metric.minMs) : 0,
  };
}

function makeGameMetric() {
  return {
    count: 0,
    teamCloneMs: makeMetric(),
    sanitizeMs: makeMetric(),
    workerRoundTripMs: makeMetric(),
    workerToPyMs: makeMetric(),
    pythonComputeMs: makeMetric(),
    workerToJsMs: makeMetric(),
    mainThreadUnaccountedMs: makeMetric(),
    payloadSamples: 0,
    payloadBytesTotal: 0,
    payloadBytesMax: 0,
  };
}

function makeStorageMetric() {
  return {
    count: 0,
    failed: 0,
    duration: makeMetric(),
  };
}

function makeInjuryMetric() {
  return {
    count: 0,
    totalDays: 0,
    maxDays: 0,
    playerKeys: {},
    durationBuckets: {
      days_1_3: 0,
      days_4_10: 0,
      days_11_21: 0,
      days_22_45: 0,
      days_46_90: 0,
      days_91_180: 0,
      days_181_365: 0,
      unknown: 0,
    },
  };
}

function injuryBucket(days) {
  const value = finite(days, 0);
  if (value >= 1 && value <= 3) return "days_1_3";
  if (value >= 4 && value <= 10) return "days_4_10";
  if (value >= 11 && value <= 21) return "days_11_21";
  if (value >= 22 && value <= 45) return "days_22_45";
  if (value >= 46 && value <= 90) return "days_46_90";
  if (value >= 91 && value <= 180) return "days_91_180";
  if (value >= 181) return "days_181_365";
  return "unknown";
}

function makeSeason(year) {
  return {
    seasonYear: Number(year),
    calendarDates: [],
    calendarRuns: [],
    phases: [],
    offseasonSteps: [],
    snapshots: [],
    cpuTradeSnapshots: [],
    storage: {},
    gameSim: {
      regular_season: makeGameMetric(),
      playoffs: makeGameMetric(),
      other: makeGameMetric(),
    },
    injuries: {
      regular_season: makeInjuryMetric(),
      playoffs: makeInjuryMetric(),
      other: makeInjuryMetric(),
    },
  };
}

function makeState() {
  return {
    version: DIAGNOSTICS_VERSION,
    enabled: false,
    label: "",
    startedAt: null,
    stoppedAt: null,
    payloadSampleCounter: 0,
    seasons: {},
    notes: [],
  };
}

let state = makeState();

function restorePersistedState() {
  try {
    if (typeof sessionStorage === "undefined") return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed?.version !== DIAGNOSTICS_VERSION || !parsed?.startedAt) return;
    state = {
      ...makeState(),
      ...parsed,
      seasons: parsed?.seasons && typeof parsed.seasons === "object" ? parsed.seasons : {},
      notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
    };
  } catch {}
}

function exposeState() {
  try {
    if (typeof window !== "undefined") {
      window.__BM_MULTI_YEAR_SPEED__ = state;
    }
  } catch {}
}

function persistCompactState() {
  if (!state.enabled && !state.startedAt) return;
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function getSeason(year) {
  const n = finite(year, 0);
  if (!n) return null;
  const key = String(n);
  if (!state.seasons[key]) state.seasons[key] = makeSeason(n);
  return state.seasons[key];
}

function monthBucket(dateString = "", tradeDeadlineDate = "") {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "unknown";
  const month = Number(match[2]);
  if (month === 10 || month === 11) return "oct_nov";
  if (month === 12) return "december";
  if (month === 1) return "january";
  if (month === 2) {
    if (tradeDeadlineDate && String(dateString) >= String(tradeDeadlineDate)) {
      return "post_deadline_february";
    }
    return "pre_deadline_february";
  }
  if (month === 3 || month === 4) return "march_april";
  return `month_${String(month).padStart(2, "0")}`;
}

function allPlayers(leagueData = {}) {
  const teams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : Object.values(leagueData?.conferences || {}).flatMap((rows) => Array.isArray(rows) ? rows : []);
  const players = [];
  for (const team of teams) {
    players.push(...(Array.isArray(team?.players) ? team.players : []));
    players.push(...(Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : []));
    players.push(...(Array.isArray(team?.stashPlayers) ? team.stashPlayers : []));
  }
  players.push(...(Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : []));
  return { teams, players };
}

function buildLeagueGrowthSummary(leagueData = {}) {
  const { teams, players } = allPlayers(leagueData);
  const freeAgents = Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : [];
  let playerSeasonRows = 0;
  let playerAccoladeRows = 0;
  let playerTransactionRows = 0;
  let activeInjuredPlayers = 0;
  let potentialBelowOverall = 0;
  const overallBands = {
    ovr_97_plus: 0,
    ovr_95_plus: 0,
    ovr_90_plus: 0,
    ovr_85_plus: 0,
    ovr_80_plus: 0,
    ovr_76_plus: 0,
    ovr_74_plus: 0,
  };

  for (const player of players) {
    playerSeasonRows += Array.isArray(player?.history?.seasons) ? player.history.seasons.length : 0;
    playerAccoladeRows += Array.isArray(player?.history?.accolades) ? player.history.accolades.length : 0;
    playerTransactionRows += Array.isArray(player?.history?.transactions) ? player.history.transactions.length : 0;
    if (player?.injury?.active) activeInjuredPlayers += 1;
    const ovr = Number(player?.overall ?? player?.ovr);
    const pot = Number(player?.potential ?? player?.pot);
    if (Number.isFinite(ovr)) {
      if (ovr >= 97) overallBands.ovr_97_plus += 1;
      if (ovr >= 95) overallBands.ovr_95_plus += 1;
      if (ovr >= 90) overallBands.ovr_90_plus += 1;
      if (ovr >= 85) overallBands.ovr_85_plus += 1;
      if (ovr >= 80) overallBands.ovr_80_plus += 1;
      if (ovr >= 76) overallBands.ovr_76_plus += 1;
      if (ovr >= 74) overallBands.ovr_74_plus += 1;
    }
    if (Number.isFinite(ovr) && Number.isFinite(pot) && pot < ovr) potentialBelowOverall += 1;
  }

  const rosterSizes = teams.map((team) =>
    (Array.isArray(team?.players) ? team.players.length : 0) +
    (Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers.length : 0)
  );
  const rosterTotal = rosterSizes.reduce((sum, value) => sum + value, 0);
  const latestHistory = Array.isArray(leagueData?.seasonHistory) && leagueData.seasonHistory.length
    ? leagueData.seasonHistory[leagueData.seasonHistory.length - 1]
    : null;

  return {
    teamCount: teams.length,
    playerCount: players.length,
    freeAgentCount: freeAgents.length,
    freeAgents76Plus: freeAgents.filter((player) => Number(player?.overall ?? player?.ovr) >= 76).length,
    freeAgents80Plus: freeAgents.filter((player) => Number(player?.overall ?? player?.ovr) >= 80).length,
    activeInjuredPlayers,
    potentialBelowOverall,
    overallBands,
    rosterSize: {
      min: rosterSizes.length ? Math.min(...rosterSizes) : 0,
      max: rosterSizes.length ? Math.max(...rosterSizes) : 0,
      average: rosterSizes.length ? round3(rosterTotal / rosterSizes.length) : 0,
      total: rosterTotal,
    },
    playerSeasonRows,
    playerAccoladeRows,
    playerTransactionRows,
    tradeHistoryRows: Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory.length : 0,
    seasonHistoryRows: Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory.length : 0,
    latestSeasonChampion: latestHistory?.champion || "",
    retiredPlayersRows: Array.isArray(leagueData?.retiredPlayersHistory) ? leagueData.retiredPlayersHistory.length : 0,
    draftPickRows: Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks.length : 0,
    financialHistoryRows: Array.isArray(leagueData?.financials?.history) ? leagueData.financials.history.length : 0,
  };
}

function buildCpuTradeBehaviorSummary(leagueData = {}, seasonYear = 0) {
  const rows = (Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [])
    .filter((row) => Boolean(row?.cpuCpuTrade || row?.source === "cpu_cpu_trade"))
    .filter((row) => !seasonYear || Number(row?.seasonYear || 0) === Number(seasonYear));

  const byMonth = {};
  const packageMix = {};
  let playersMoved = 0;
  let picksMoved = 0;
  let megaTrades = 0;
  let starPlayerMoves90Plus = 0;
  let starPlayerMoves88Plus = 0;
  const playerOvrs = [];
  const playerPots = [];

  for (const row of rows) {
    const date = String(row?.date || row?.currentDate || "");
    const month = date.match(/^(\d{4}-\d{2})/)?.[1] || "unknown";
    byMonth[month] = finite(byMonth[month], 0) + 1;
    if (row?.cpuMegaTrade || row?.megaTrade || row?.tradeType === "cpu_mega_trade") megaTrades += 1;

    const packages = Array.isArray(row?.teamPackages) ? row.teamPackages : [];
    const sideLabels = [];
    for (const side of packages) {
      const sent = Array.isArray(side?.sent) ? side.sent : [];
      const playerAssets = sent.filter((asset) => asset?.type === "player");
      const pickAssets = sent.filter((asset) => asset?.type === "pick");
      playersMoved += playerAssets.length;
      picksMoved += pickAssets.length;
      sideLabels.push(`${playerAssets.length}p${pickAssets.length ? `+${pickAssets.length}d` : ""}`);
      for (const asset of playerAssets) {
        const ovr = Number(asset?.overall);
        const pot = Number(asset?.potential);
        if (Number.isFinite(ovr)) {
          playerOvrs.push(ovr);
          if (ovr >= 90) starPlayerMoves90Plus += 1;
          if (ovr >= 88) starPlayerMoves88Plus += 1;
        }
        if (Number.isFinite(pot)) playerPots.push(pot);
      }
    }
    const packageKey = sideLabels.sort().join(" v ") || "unknown";
    packageMix[packageKey] = finite(packageMix[packageKey], 0) + 1;
  }

  const mean = (values) => values.length
    ? round3(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;

  return {
    completedCpuTrades: rows.length,
    tradesByMonth: byMonth,
    megaTrades,
    playersMoved,
    picksMoved,
    starPlayerMoves90Plus,
    starPlayerMoves88Plus,
    averageMovedPlayerOverall: mean(playerOvrs),
    averageMovedPlayerPotential: mean(playerPots),
    packageMix,
  };
}

function compactCpuTradeReport(report = {}) {
  if (!report || typeof report !== "object") return null;
  return {
    generatedAt: report.generatedAt || nowIso(),
    summary: safeClone(report.summary || {}),
    bankStats: safeClone(report.bank?.stats || {}),
    candidateFunnel: safeClone(report.candidateFunnel || {}),
    validation: safeClone(report.validation || {}),
    bankHealth: safeClone(report.bankHealth || {}),
    tradeQuality: safeClone(report.tradeQuality || {}),
    feedConsistency: safeClone(report.feedConsistency || {}),
    integrity: safeClone(report.integrity || {}),
    ratingFreeze: safeClone(report.ratingFreeze || {}),
    rosterRepair: safeClone(report.rosterRepair || {}),
    io: safeClone(report.io || {}),
    timings: safeClone(report.timings || {}),
    checks: safeClone(report.checks || []),
  };
}

export function isMultiYearSpeedDiagnosticsEnabled() {
  return Boolean(state.enabled);
}

export function startMultiYearSpeedDiagnostics({ label = "y1-y3-baseline" } = {}) {
  state = makeState();
  state.enabled = true;
  state.label = String(label || "y1-y3-baseline");
  state.startedAt = nowIso();
  state.notes.push({ at: state.startedAt, note: "diagnostics_started" });
  exposeState();
  persistCompactState();
  return getMultiYearSpeedDiagnosticsStatus();
}

export function stopMultiYearSpeedDiagnostics() {
  state.enabled = false;
  state.stoppedAt = nowIso();
  state.notes.push({ at: state.stoppedAt, note: "diagnostics_stopped" });
  exposeState();
  persistCompactState();
  return getMultiYearSpeedDiagnosticsStatus();
}

export function resetMultiYearSpeedDiagnostics() {
  state = makeState();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
  exposeState();
  return getMultiYearSpeedDiagnosticsStatus();
}

export function getMultiYearSpeedDiagnosticsStatus() {
  return {
    enabled: Boolean(state.enabled),
    label: state.label,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    seasonsTracked: Object.keys(state.seasons).map(Number).sort((a, b) => a - b),
  };
}

export function shouldSampleMultiYearGamePayload(every = 50) {
  if (!state.enabled) return false;
  state.payloadSampleCounter += 1;
  return state.payloadSampleCounter === 1 || state.payloadSampleCounter % Math.max(1, finite(every, 50)) === 0;
}

export function recordMultiYearGameSimTiming({
  seasonYear = 0,
  phase = "other",
  teamCloneMs = 0,
  sanitizeMs = 0,
  workerRoundTripMs = 0,
  workerToPyMs = 0,
  pythonComputeMs = 0,
  workerToJsMs = 0,
  payloadBytes = 0,
} = {}) {
  if (!state.enabled) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  const key = phase === "regular_season" || phase === "playoffs" ? phase : "other";
  const metric = season.gameSim[key];
  metric.count += 1;
  addMetric(metric.teamCloneMs, teamCloneMs);
  addMetric(metric.sanitizeMs, sanitizeMs);
  addMetric(metric.workerRoundTripMs, workerRoundTripMs);
  addMetric(metric.workerToPyMs, workerToPyMs);
  addMetric(metric.pythonComputeMs, pythonComputeMs);
  addMetric(metric.workerToJsMs, workerToJsMs);
  const workerKnown = finite(workerToPyMs) + finite(pythonComputeMs) + finite(workerToJsMs);
  addMetric(metric.mainThreadUnaccountedMs, Math.max(0, finite(workerRoundTripMs) - workerKnown));
  if (finite(payloadBytes, 0) > 0) {
    metric.payloadSamples += 1;
    metric.payloadBytesTotal += finite(payloadBytes, 0);
    metric.payloadBytesMax = Math.max(metric.payloadBytesMax, finite(payloadBytes, 0));
  }
}

export function recordMultiYearInjuryEvents({ seasonYear = 0, phase = "other", events = [] } = {}) {
  if (!state.enabled || !Array.isArray(events) || !events.length) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  const key = phase === "regular_season" || phase === "playoffs" ? phase : "other";
  const metric = season.injuries[key];
  for (const event of events) {
    if (event?.type !== "injury") continue;
    const days = Math.max(0, finite(event?.days, 0));
    metric.count += 1;
    metric.totalDays += days;
    metric.maxDays = Math.max(metric.maxDays, days);
    const bucket = injuryBucket(days);
    metric.durationBuckets[bucket] = finite(metric.durationBuckets[bucket], 0) + 1;
    const playerKey = `${String(event?.teamName || "")}::${String(event?.playerName || "")}`;
    if (playerKey !== "::") metric.playerKeys[playerKey] = true;
  }
}

export function recordMultiYearStorageWrite({
  seasonYear = 0,
  mode = "full_league",
  source = "unknown",
  durationMs = 0,
  ok = true,
} = {}) {
  if (!state.enabled) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  const key = `${String(mode || "unknown")}|${String(source || "unknown")}`;
  if (!season.storage[key]) season.storage[key] = makeStorageMetric();
  const metric = season.storage[key];
  metric.count += 1;
  if (!ok) metric.failed += 1;
  addMetric(metric.duration, durationMs);
}

export function recordMultiYearCalendarDate({
  seasonYear = 0,
  date = "",
  elapsedMs = 0,
  gamesSimmed = 0,
  cpuTradeMs = 0,
  cpuTradePasses = 0,
  tradeDeadlineDate = "",
} = {}) {
  if (!state.enabled) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  season.calendarDates.push({
    date: String(date || ""),
    bucket: monthBucket(date, tradeDeadlineDate),
    elapsedMs: round3(elapsedMs),
    gamesSimmed: finite(gamesSimmed, 0),
    cpuTradeMs: round3(cpuTradeMs),
    cpuTradePasses: finite(cpuTradePasses, 0),
  });
}

export function recordMultiYearCalendarRun(payload = {}) {
  if (!state.enabled) return;
  const season = getSeason(payload?.seasonYear);
  if (!season) return;
  season.calendarRuns.push({
    mode: payload?.mode || "simulation",
    runId: payload?.runId || "",
    startedAt: payload?.startedAt || null,
    elapsedMs: round3(payload?.elapsedMs),
    totalWallMs: round3(payload?.totalWallMs ?? payload?.elapsedMs),
    preSimRepairMs: round3(payload?.preSimRepairMs),
    firstPendingDate: payload?.firstPendingDate || "",
    lastDateProcessed: payload?.lastDateProcessed || "",
    gamesSimmed: finite(payload?.gamesSimmed, 0),
    scheduledGames: finite(payload?.scheduledGames, 0),
    committedGames: finite(payload?.committedGames, 0),
    injuriesGenerated: finite(payload?.injuriesGenerated, 0),
    gameErrors: finite(payload?.gameErrors, 0),
    cpuTradePasses: finite(payload?.cpuTradePasses, 0),
    cpuTradeMs: round3(payload?.cpuTradeMs),
    cpuTradesCompleted: finite(payload?.cpuTradesCompleted, 0),
    stopped: Boolean(payload?.stopped),
    pausedAtCheckpoint: Boolean(payload?.pausedAtCheckpoint),
    pausedForTradeDeadline: Boolean(payload?.pausedForTradeDeadline),
    pausedForContractExtensionDeadline: Boolean(payload?.pausedForContractExtensionDeadline),
    pausedForAllStar: Boolean(payload?.pausedForAllStar),
    pausedForInjuryAlert: Boolean(payload?.pausedForInjuryAlert),
    gameOrderDateInversions: finite(payload?.gameOrderDateInversions, 0),
  });
  persistCompactState();
}

export function recordMultiYearLeagueSnapshot(leagueData, {
  seasonYear = 0,
  checkpoint = "snapshot",
  date = "",
  replace = false,
} = {}) {
  if (!state.enabled || !leagueData || typeof leagueData !== "object") return null;
  const resolvedYear = finite(seasonYear, seasonYearOf(leagueData));
  const season = getSeason(resolvedYear);
  if (!season) return null;
  const existingIndex = season.snapshots.findIndex((row) => row.checkpoint === checkpoint);
  if (existingIndex >= 0 && !replace) return season.snapshots[existingIndex];

  const startedAt = nowMs();
  let serializedBytes = 0;
  try {
    serializedBytes = JSON.stringify(leagueData).length;
  } catch {}
  const row = {
    checkpoint,
    date: String(date || ""),
    capturedAt: nowIso(),
    serializedBytes,
    measureMs: round3(nowMs() - startedAt),
    ...buildLeagueGrowthSummary(leagueData),
  };
  if (existingIndex >= 0) season.snapshots[existingIndex] = row;
  else season.snapshots.push(row);
  persistCompactState();
  return row;
}

export function recordMultiYearCpuTradeSnapshot({ seasonYear = 0, checkpoint = "season_end", report = null, leagueData = null } = {}) {
  if (!state.enabled) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  const compact = compactCpuTradeReport(report);
  if (!compact) return;
  const row = {
    checkpoint,
    ...compact,
    behavior: buildCpuTradeBehaviorSummary(leagueData || {}, seasonYear),
  };
  const index = season.cpuTradeSnapshots.findIndex((entry) => entry.checkpoint === checkpoint);
  if (index >= 0) season.cpuTradeSnapshots[index] = row;
  else season.cpuTradeSnapshots.push(row);
  persistCompactState();
}

export function recordMultiYearPhaseTiming({ seasonYear = 0, phase = "other", elapsedMs = 0, details = {} } = {}) {
  if (!state.enabled) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  season.phases.push({
    phase: String(phase || "other"),
    elapsedMs: round3(elapsedMs),
    recordedAt: nowIso(),
    details: safeClone(details || {}),
  });
  persistCompactState();
}

export function recordMultiYearOffseasonStepTiming({ seasonYear = 0, step = "other", elapsedMs = 0, details = {} } = {}) {
  if (!state.enabled) return;
  const season = getSeason(seasonYear);
  if (!season) return;
  season.offseasonSteps.push({
    step: String(step || "other"),
    elapsedMs: round3(elapsedMs),
    recordedAt: nowIso(),
    details: safeClone(details || {}),
  });
}

function summarizeDateBuckets(rows = []) {
  const buckets = {};
  for (const row of rows) {
    const key = row.bucket || "unknown";
    if (!buckets[key]) buckets[key] = { elapsedMs: 0, gamesSimmed: 0, cpuTradeMs: 0, cpuTradePasses: 0, dates: 0 };
    buckets[key].elapsedMs += finite(row.elapsedMs);
    buckets[key].gamesSimmed += finite(row.gamesSimmed);
    buckets[key].cpuTradeMs += finite(row.cpuTradeMs);
    buckets[key].cpuTradePasses += finite(row.cpuTradePasses);
    buckets[key].dates += 1;
  }
  for (const bucket of Object.values(buckets)) {
    bucket.elapsedMs = round3(bucket.elapsedMs);
    bucket.cpuTradeMs = round3(bucket.cpuTradeMs);
    bucket.msPerGame = bucket.gamesSimmed ? round3(bucket.elapsedMs / bucket.gamesSimmed) : 0;
  }
  return buckets;
}

function summarizeSeasonQuarters(rows = [], calendarElapsedMs = 0, calendarGames = 0) {
  const sorted = [...rows]
    .filter((row) => row && row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const quarters = {};
  if (sorted.length) {
    for (let index = 0; index < sorted.length; index += 1) {
      const quarterIndex = Math.min(3, Math.floor((index * 4) / sorted.length));
      const key = `q${quarterIndex + 1}`;
      if (!quarters[key]) {
        quarters[key] = {
          startDate: sorted[index].date,
          endDate: sorted[index].date,
          elapsedMs: 0,
          gamesSimmed: 0,
          cpuTradeMs: 0,
          cpuTradePasses: 0,
          dates: 0,
        };
      }
      const quarterRow = quarters[key];
      quarterRow.endDate = sorted[index].date;
      quarterRow.elapsedMs += finite(sorted[index].elapsedMs);
      quarterRow.gamesSimmed += finite(sorted[index].gamesSimmed);
      quarterRow.cpuTradeMs += finite(sorted[index].cpuTradeMs);
      quarterRow.cpuTradePasses += finite(sorted[index].cpuTradePasses);
      quarterRow.dates += 1;
    }
  }

  for (let index = 1; index <= 4; index += 1) {
    const key = `q${index}`;
    const quarterRow = quarters[key] || {
      startDate: "", endDate: "", elapsedMs: 0, gamesSimmed: 0, cpuTradeMs: 0, cpuTradePasses: 0, dates: 0,
    };
    quarterRow.elapsedMs = round3(quarterRow.elapsedMs);
    quarterRow.cpuTradeMs = round3(quarterRow.cpuTradeMs);
    quarterRow.nonCpuTradeMs = round3(Math.max(0, quarterRow.elapsedMs - quarterRow.cpuTradeMs));
    quarterRow.msPerGame = quarterRow.gamesSimmed ? round3(quarterRow.elapsedMs / quarterRow.gamesSimmed) : 0;
    quarterRow.nonCpuTradeMsPerGame = quarterRow.gamesSimmed ? round3(quarterRow.nonCpuTradeMs / quarterRow.gamesSimmed) : 0;
    quarterRow.cpuTradeSharePct = quarterRow.elapsedMs ? round3((quarterRow.cpuTradeMs / quarterRow.elapsedMs) * 100) : 0;
    quarters[key] = quarterRow;
  }

  const attributedElapsedMs = round3(sorted.reduce((sum, row) => sum + finite(row.elapsedMs), 0));
  const attributedGames = sorted.reduce((sum, row) => sum + finite(row.gamesSimmed), 0);

  return {
    ...quarters,
    coverage: {
      attributedElapsedMs,
      unattributedElapsedMs: round3(Math.max(0, finite(calendarElapsedMs) - attributedElapsedMs)),
      attributedGames,
      unattributedGames: Math.max(0, finite(calendarGames) - attributedGames),
      elapsedCoveragePct: calendarElapsedMs ? round3((attributedElapsedMs / calendarElapsedMs) * 100) : 0,
      gameCoveragePct: calendarGames ? round3((attributedGames / calendarGames) * 100) : 0,
    },
  };
}

function summarizeGameMetric(metric = makeGameMetric()) {
  return {
    games: finite(metric.count, 0),
    teamClone: finalizeMetric(metric.teamCloneMs),
    sanitize: finalizeMetric(metric.sanitizeMs),
    workerRoundTrip: finalizeMetric(metric.workerRoundTripMs),
    workerToPy: finalizeMetric(metric.workerToPyMs),
    pythonCompute: finalizeMetric(metric.pythonComputeMs),
    workerToJs: finalizeMetric(metric.workerToJsMs),
    roundTripMinusMeasuredWorker: finalizeMetric(metric.mainThreadUnaccountedMs),
    payloadSamples: finite(metric.payloadSamples, 0),
    averageSampledPayloadBytes: metric.payloadSamples ? Math.round(metric.payloadBytesTotal / metric.payloadSamples) : 0,
    maxSampledPayloadBytes: Math.round(finite(metric.payloadBytesMax, 0)),
  };
}

function summarizeInjuryMetric(metric = makeInjuryMetric()) {
  const count = finite(metric.count, 0);
  return {
    injuries: count,
    uniquePlayersInjured: Object.keys(metric.playerKeys || {}).length,
    totalInjuryDays: finite(metric.totalDays, 0),
    averageInjuryDays: count ? round3(finite(metric.totalDays, 0) / count) : 0,
    maxInjuryDays: finite(metric.maxDays, 0),
    durationBuckets: safeClone(metric.durationBuckets || {}),
  };
}

function summarizeStorage(storage = {}) {
  const byMode = {};
  const bySource = {};
  for (const [key, metric] of Object.entries(storage)) {
    const [mode, source] = key.split("|");
    const finalized = finalizeMetric(metric.duration);
    const row = {
      mode,
      source,
      count: metric.count,
      failed: metric.failed,
      ...finalized,
    };
    bySource[key] = row;
    if (!byMode[mode]) byMode[mode] = { count: 0, failed: 0, totalMs: 0, maxMs: 0 };
    byMode[mode].count += metric.count;
    byMode[mode].failed += metric.failed;
    byMode[mode].totalMs += finite(finalized.totalMs);
    byMode[mode].maxMs = Math.max(byMode[mode].maxMs, finite(finalized.maxMs));
  }
  for (const row of Object.values(byMode)) {
    row.totalMs = round3(row.totalMs);
    row.averageMs = row.count ? round3(row.totalMs / row.count) : 0;
    row.maxMs = round3(row.maxMs);
  }
  return { byMode, bySource };
}

function summarizeSeason(season = {}) {
  // Use the core Calendar elapsed time plus the explicitly-measured pre-sim roster repair.
  // `totalWallMs` intentionally stays in the raw run rows for observation, but it can include
  // diagnostics-only snapshot bookkeeping around the handler. Keeping that overhead out of the
  // headline baseline makes Y1/Y2/Y3 comparisons about game work rather than the profiler itself.
  const calendarElapsedMs = season.calendarRuns.reduce(
    (sum, row) => sum + finite(row.elapsedMs) + finite(row.preSimRepairMs),
    0,
  );
  const calendarGames = season.calendarRuns.reduce((sum, row) => sum + finite(row.gamesSimmed), 0);
  const scheduledGames = season.calendarRuns.reduce((max, row) => Math.max(max, finite(row.scheduledGames)), 0);
  const committedGames = season.calendarRuns.reduce((max, row) => Math.max(max, finite(row.committedGames)), 0);
  const injuriesGenerated = season.calendarRuns.reduce((sum, row) => sum + finite(row.injuriesGenerated), 0);
  const gameErrors = season.calendarRuns.reduce((sum, row) => sum + finite(row.gameErrors), 0);
  const dateInversions = season.calendarRuns.reduce((sum, row) => sum + finite(row.gameOrderDateInversions), 0);
  const phaseTotals = {};
  for (const row of season.phases) {
    phaseTotals[row.phase] = round3(finite(phaseTotals[row.phase]) + finite(row.elapsedMs));
  }
  const offseasonElapsedMs = season.offseasonSteps.reduce((sum, row) => sum + finite(row.elapsedMs), 0);
  const playoffElapsedMs = finite(phaseTotals.playoffs, 0);
  const fullYearMeasuredMs = calendarElapsedMs + playoffElapsedMs + offseasonElapsedMs;
  return {
    seasonYear: season.seasonYear,
    overall: {
      regularSeasonWallMs: round3(calendarElapsedMs),
      playoffsWallMs: round3(playoffElapsedMs),
      offseasonComputeMs: round3(offseasonElapsedMs),
      fullYearMeasuredMs: round3(fullYearMeasuredMs),
      gamesSimulated: calendarGames,
      gamesScheduled: scheduledGames,
      gamesCommitted: committedGames,
      injuriesGenerated,
      gameErrors,
      gameOrderDateInversions: dateInversions,
      regularSeasonMsPerGame: calendarGames ? round3(calendarElapsedMs / calendarGames) : 0,
    },
    monthly: summarizeDateBuckets(season.calendarDates),
    quarters: summarizeSeasonQuarters(season.calendarDates, calendarElapsedMs, calendarGames),
    gameSimulation: {
      regularSeason: summarizeGameMetric(season.gameSim.regular_season),
      playoffs: summarizeGameMetric(season.gameSim.playoffs),
      other: summarizeGameMetric(season.gameSim.other),
    },
    injuryParity: {
      regularSeason: summarizeInjuryMetric(season.injuries?.regular_season),
      playoffs: summarizeInjuryMetric(season.injuries?.playoffs),
      other: summarizeInjuryMetric(season.injuries?.other),
    },
    storage: summarizeStorage(season.storage),
    leagueGrowthSnapshots: safeClone(season.snapshots),
    cpuTrade: safeClone(season.cpuTradeSnapshots),
    calendarRuns: safeClone(season.calendarRuns),
    phases: safeClone(season.phases),
    offseasonSteps: safeClone(season.offseasonSteps),
  };
}

function percentGrowth(before, after) {
  const a = finite(before, 0);
  const b = finite(after, 0);
  if (!a) return null;
  return round3(((b - a) / a) * 100);
}

export function buildMultiYearSpeedReport() {
  const seasons = Object.values(state.seasons)
    .sort((a, b) => a.seasonYear - b.seasonYear)
    .map(summarizeSeason);
  const curve = [];
  for (let index = 1; index < seasons.length; index++) {
    const before = seasons[index - 1];
    const after = seasons[index];
    curve.push({
      fromSeasonYear: before.seasonYear,
      toSeasonYear: after.seasonYear,
      regularSeasonSlowdownPct: percentGrowth(before.overall.regularSeasonWallMs, after.overall.regularSeasonWallMs),
      regularSeasonMsPerGameSlowdownPct: percentGrowth(before.overall.regularSeasonMsPerGame, after.overall.regularSeasonMsPerGame),
      fullYearMeasuredSlowdownPct: percentGrowth(before.overall.fullYearMeasuredMs, after.overall.fullYearMeasuredMs),
    });
  }
  if (seasons.length >= 3) {
    curve.push({
      fromSeasonYear: seasons[0].seasonYear,
      toSeasonYear: seasons[2].seasonYear,
      regularSeasonSlowdownPct: percentGrowth(seasons[0].overall.regularSeasonWallMs, seasons[2].overall.regularSeasonWallMs),
      regularSeasonMsPerGameSlowdownPct: percentGrowth(seasons[0].overall.regularSeasonMsPerGame, seasons[2].overall.regularSeasonMsPerGame),
      fullYearMeasuredSlowdownPct: percentGrowth(seasons[0].overall.fullYearMeasuredMs, seasons[2].overall.fullYearMeasuredMs),
    });
  }

  return {
    name: "basketball_manager_multi_year_speed_report",
    version: DIAGNOSTICS_VERSION,
    generatedAt: nowIso(),
    label: state.label,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    enabled: state.enabled,
    seasonCount: seasons.length,
    seasons,
    slowdownCurve: curve,
    notes: safeClone(state.notes),
  };
}

export async function copyMultiYearSpeedReport() {
  const report = buildMultiYearSpeedReport();
  const json = JSON.stringify(report, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    console.log("[BM MULTI-YEAR SPEED] Copied report to clipboard.");
  } catch (error) {
    console.warn("[BM MULTI-YEAR SPEED] Clipboard copy failed; returning JSON instead.", error);
  }
  return json;
}

restorePersistedState();
exposeState();
