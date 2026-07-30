import {
  buildCpuTradeBankSummary,
  getCpuTradeCandidateSignature,
} from "./cpuTradeBank.js";
import { validateCpuTradeCandidateOnLeague } from "./tradeExecution.js";
import { getCpuTradeImpactCacheStats } from "./tradeTeamImpact.js";
import {
  buildTradeHistoryLogEntry,
  readTradeDeskFeed,
} from "./tradeDeskFeed.js";
import {
  getAllTeamsFromLeague,
  normalizeDraftPicks,
  normalizeTeamName,
} from "./draftPicks.js";
import {
  CPU_TRADE_TELEMETRY_VERSION,
  ensureCpuTradeTelemetrySession,
  getCpuTradeBenchmarkSamples,
  getCpuTradeTelemetryBaseline,
  getCpuTradeTelemetrySnapshot,
  resetCpuTradeTelemetry,
  setCpuTradeTelemetryBaseline,
  withCpuTradeTelemetrySuppressed,
} from "./cpuTradeTelemetry.js";

export const CPU_TRADE_DIAGNOSTICS_VERSION = "2026-07-30_speed_v8_reliable_24_30_market";
export const CPU_TRADE_BASELINE_REPORT_KEY = "bm_cpu_trade_diagnostic_baseline_v1";

const RATING_KEYS = [
  "overall", "ovr", "potential", "pot", "offRating", "defRating", "stamina",
  "threePoint", "threePt", "midRange", "closeShot", "freeThrow", "ballHandling",
  "passing", "speed", "athleticism", "perimeterDefense", "interiorDefense", "block",
  "steal", "rebounding", "offensiveIQ", "defensiveIQ",
];

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value) {
  return Math.round(finiteNumber(value, 0) * 1000) / 1000;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function safeJsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function hashString(value = "") {
  let hash = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function playerNameOf(player = {}) {
  return player?.name || player?.player || player?.fullName || "Unknown Player";
}

function playerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.personId ?? player?.nbaId;
  if (id !== null && id !== undefined && String(id).trim()) return `id:${String(id)}`;
  return `name:${normalizeText(playerNameOf(player))}`;
}

function teamNameOf(team = {}) {
  return team?.name || team?.teamName || team?.team || "Unknown Team";
}

function seasonYearOf(leagueData = {}) {
  return Math.trunc(
    finiteNumber(
      leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.seasonStartYear,
      0
    )
  );
}

function currentSeasonCpuTrades(leagueData = {}) {
  const seasonYear = seasonYearOf(leagueData);
  return (Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : []).filter((row) => {
    if (!row || !(row.cpuCpuTrade || row.source === "cpu_cpu_trade")) return false;
    const rowSeason = Math.trunc(finiteNumber(row?.seasonYear, seasonYear));
    return !seasonYear || !rowSeason || rowSeason === seasonYear;
  });
}

function getAllPlayerLocations(leagueData = {}) {
  const rows = [];
  for (const team of getAllTeamsFromLeague(leagueData)) {
    const teamName = teamNameOf(team);
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      rows.push({ player, teamName, rosterType: "standard" });
    }
    for (const player of Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : []) {
      rows.push({ player, teamName, rosterType: "two_way" });
    }
  }
  for (const player of Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : []) {
    rows.push({ player, teamName: "Free Agency", rosterType: "free_agent" });
  }
  return rows;
}

function ratingProjection(player = {}) {
  const projection = {};
  for (const key of RATING_KEYS) {
    if (player?.[key] !== undefined) projection[key] = player[key];
  }
  for (const key of ["ratings", "attributes", "skills"]) {
    if (player?.[key] && typeof player[key] === "object") projection[key] = player[key];
  }
  return projection;
}

function buildRatingRows(leagueData = {}) {
  return getAllPlayerLocations(leagueData)
    .map(({ player }) => ({
      id: playerIdentity(player),
      name: playerNameOf(player),
      ratingHash: hashString(stableStringify(ratingProjection(player))),
      ratingProjection: ratingProjection(player),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildOwnershipRows(leagueData = {}) {
  return getAllPlayerLocations(leagueData)
    .map(({ player, teamName, rosterType }) => ({
      id: playerIdentity(player),
      name: playerNameOf(player),
      teamName,
      rosterType,
    }))
    .sort((a, b) => `${a.id}|${a.teamName}`.localeCompare(`${b.id}|${b.teamName}`));
}

function buildPickRows(leagueData = {}) {
  const teamNames = getAllTeamsFromLeague(leagueData).map(teamNameOf);
  return normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .map((pick) => ({
      id: String(pick?.id || pick?.pickId || ""),
      assetType: pick?.assetType || pick?.type || "pick",
      year: finiteNumber(pick?.year ?? pick?.seasonYear, 0),
      round: finiteNumber(pick?.round, 0),
      originalTeam: pick?.originalTeam || pick?.originalTeamName || "",
      ownerTeam: pick?.ownerTeam || pick?.currentOwnerTeamName || pick?.owner || "",
      protection: pick?.displayProtection || pick?.protection || pick?.protections || "Unprotected",
      swapWithTeam: pick?.swapWithTeam || pick?.swapTeam || "",
      status: pick?.status || "active",
    }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

export function buildCpuTradeLeagueFingerprint(leagueData = {}) {
  const ratingRows = buildRatingRows(leagueData);
  const ownershipRows = buildOwnershipRows(leagueData);
  const pickRows = buildPickRows(leagueData);
  return {
    seasonYear: seasonYearOf(leagueData),
    teamCount: getAllTeamsFromLeague(leagueData).length,
    playerCount: ownershipRows.length,
    pickCount: pickRows.length,
    ratingsHash: hashString(stableStringify(ratingRows.map(({ id, ratingHash }) => ({ id, ratingHash })))),
    ownershipHash: hashString(stableStringify(ownershipRows)),
    picksHash: hashString(stableStringify(pickRows)),
    ratingRows,
    ownershipRows,
    pickRows,
  };
}

export function ensureCpuTradeDiagnosticsSession({ leagueData, bankState, context = {}, selectedTeam = null } = {}) {
  if (!leagueData || !bankState) return null;
  const sessionKey = `${bankState?.seasonYear || seasonYearOf(leagueData)}|${bankState?.seed || "no_seed"}`;
  ensureCpuTradeTelemetrySession(sessionKey, {
    seasonYear: bankState?.seasonYear || seasonYearOf(leagueData),
    bankSeed: bankState?.seed || "",
    userTeamName: context?.userTeamName || teamNameOf(selectedTeam || {}),
    tradeDeadlineDate: context?.tradeDeadlineDate || "",
    firstObservedDate: context?.currentDate || "",
  });

  if (!getCpuTradeTelemetryBaseline()) {
    const fingerprint = buildCpuTradeLeagueFingerprint(leagueData);
    setCpuTradeTelemetryBaseline({
      sessionKey,
      context: safeJsonClone(context || {}),
      userTeamName: context?.userTeamName || teamNameOf(selectedTeam || {}),
      bankSeed: bankState?.seed || "",
      bankTargetTrades: finiteNumber(bankState?.targetTrades, 0),
      fingerprint,
    });
  }
  return sessionKey;
}

function metricStats(metric = {}) {
  const samples = Array.isArray(metric?.samples) ? [...metric.samples].sort((a, b) => a - b) : [];
  const percentile = (p) => {
    if (!samples.length) return 0;
    const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * p) - 1));
    return round3(samples[index]);
  };
  return {
    count: finiteNumber(metric?.count, 0),
    totalMs: round3(metric?.totalMs || 0),
    averageMs: metric?.count ? round3(finiteNumber(metric?.totalMs, 0) / metric.count) : 0,
    minMs: round3(metric?.minMs || 0),
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: round3(metric?.maxMs || 0),
  };
}

function summarizeMetrics(metrics = {}) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, metric]) => [key, metricStats(metric)])
  );
}

function summarizeValidationTelemetry(telemetry = {}) {
  const rows = Array.isArray(telemetry?.validationBySignature)
    ? telemetry.validationBySignature
    : [];
  const repeated = rows.filter((row) => finiteNumber(row?.count, 0) > 1);
  const repeatedRejected = repeated.filter((row) => finiteNumber(row?.rejected, 0) > 1);
  const totalCalls = rows.reduce((sum, row) => sum + finiteNumber(row?.count, 0), 0);
  return {
    uniqueSignatures: rows.length,
    totalValidationCalls: totalCalls,
    repeatedSignatureCount: repeated.length,
    repeatedRejectedSignatureCount: repeatedRejected.length,
    avoidableRepeatCalls: repeated.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.count, 0) - 1), 0),
    mostRepeated: [...rows]
      .sort((a, b) => finiteNumber(b?.count, 0) - finiteNumber(a?.count, 0))
      .slice(0, 10)
      .map((row) => ({
        signature: row.signature,
        count: row.count,
        accepted: row.accepted,
        rejected: row.rejected,
        totalMs: round3(row.totalMs),
        phases: row.phases,
        package: row.package,
        teams: row.teams,
        lastResult: row.lastResult,
      })),
  };
}

function marginForView(view = {}) {
  const threshold = finiteNumber(view?.teamImpact?.threshold ?? view?.threshold, 0);
  return round3(finiteNumber(view?.score, 0) - threshold);
}

function teamViewAccepted(view = {}) {
  return Boolean(view?.accepted || ["accept", "accepted"].includes(String(view?.decision || "").toLowerCase()));
}

function assetSummaryFromTrade(trade = {}) {
  const packages = Array.isArray(trade?.teamPackages) ? trade.teamPackages : [];
  const assets = packages.flatMap((side) => Array.isArray(side?.received) ? side.received : []);
  const players = assets
    .filter((asset) => asset?.type === "player")
    .map((asset) => asset?.playerName || asset?.label || asset?.player?.name)
    .filter(Boolean);
  const picks = assets.filter((asset) => asset?.type === "pick").length;
  const sideCounts = packages.map((side) => ({
    teamName: side?.teamName || "",
    players: (side?.received || []).filter((asset) => asset?.type === "player").length,
    picks: (side?.received || []).filter((asset) => asset?.type === "pick").length,
  }));
  return { players, picks, sideCounts };
}

function summarizeTradeQuality(trades = []) {
  const rows = trades.map((trade) => {
    const buyerMargin = marginForView(trade?.toTeamView || {});
    const sellerMargin = marginForView(trade?.fromTeamView || {});
    const assets = assetSummaryFromTrade(trade);
    return {
      id: trade?.id || trade?.tradeRecordId || trade?.bankId || "",
      date: trade?.date || trade?.currentDate || "",
      fromTeamName: trade?.fromTeamName || "",
      toTeamName: trade?.toTeamName || "",
      buyerAccepted: teamViewAccepted(trade?.toTeamView || {}),
      sellerAccepted: teamViewAccepted(trade?.fromTeamView || {}),
      buyerScore: round3(trade?.toTeamView?.score || 0),
      buyerThreshold: round3(trade?.toTeamView?.teamImpact?.threshold ?? trade?.toTeamView?.threshold ?? 0),
      buyerMargin,
      sellerScore: round3(trade?.fromTeamView?.score || 0),
      sellerThreshold: round3(trade?.fromTeamView?.teamImpact?.threshold ?? trade?.fromTeamView?.threshold ?? 0),
      sellerMargin,
      minimumMargin: Math.min(buyerMargin, sellerMargin),
      combinedMargin: round3(buyerMargin + sellerMargin),
      picks: assets.picks,
      movedPlayers: assets.players,
      sideCounts: assets.sideCounts,
    };
  });
  const margins = rows.flatMap((row) => [row.buyerMargin, row.sellerMargin]).sort((a, b) => a - b);
  const minMargins = rows.map((row) => row.minimumMargin).sort((a, b) => a - b);
  const mean = (values) => values.length ? round3(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const median = (values) => values.length ? values[Math.floor((values.length - 1) / 2)] : 0;
  const p10 = (values) => values.length ? values[Math.max(0, Math.ceil(values.length * 0.1) - 1)] : 0;
  const mix = {};
  for (const row of rows) {
    const sides = row.sideCounts.map((side) => `${side.players}p${side.picks ? `+${side.picks}d` : ""}`).sort();
    const key = sides.join(" v ") || "unknown";
    mix[key] = finiteNumber(mix[key], 0) + 1;
  }
  return {
    completedTrades: rows.length,
    tradesWithBothTeamViews: rows.filter((row) => row.buyerAccepted && row.sellerAccepted).length,
    averageDecisionMargin: mean(margins),
    medianMinimumMargin: round3(median(minMargins)),
    p10MinimumMargin: round3(p10(minMargins)),
    worstMinimumMargin: minMargins.length ? round3(minMargins[0]) : 0,
    borderlineTrades: rows.filter((row) => row.minimumMargin <= 0.5).length,
    pickTrades: rows.filter((row) => row.picks > 0).length,
    packageMix: mix,
    worstFive: [...rows].sort((a, b) => a.minimumMargin - b.minimumMargin).slice(0, 5),
    rows,
  };
}

function tradeKeyFromRecord(trade = {}) {
  const historyEntry = buildTradeHistoryLogEntry(trade);
  if (historyEntry?.tradeRecordId) return `id:${historyEntry.tradeRecordId}`;
  if (trade?.id) return `id:${trade.id}`;
  const teams = [trade?.fromTeamName || "", trade?.toTeamName || ""].map(normalizeText).sort();
  const players = assetSummaryFromTrade(trade).players.map(normalizeText).sort();
  return `fallback:${trade?.date || trade?.currentDate || ""}|${teams.join("|")}|${players.join("|")}`;
}

function tradeKeyFromFeed(entry = {}) {
  if (entry?.tradeRecordId) return `id:${entry.tradeRecordId}`;
  const teams = (entry?.teamNames || []).map(normalizeText).sort();
  const players = (entry?.playerNames || []).map(normalizeText).sort();
  return `fallback:${entry?.date || entry?.currentDate || ""}|${teams.join("|")}|${players.join("|")}`;
}

function summarizeFeedConsistency(trades = []) {
  const feed = readTradeDeskFeed();
  const transactionRows = feed.filter((row) =>
    row?.type === "transaction" &&
    (row?.cpuCpuTrade || row?.source === "cpu_cpu_trade" || row?.label === "Transaction Wire")
  );
  const historyKeys = new Set(trades.map(tradeKeyFromRecord));
  const feedKeys = new Set(transactionRows.map(tradeKeyFromFeed));
  const stale = transactionRows.filter((row) => !historyKeys.has(tradeKeyFromFeed(row)));
  const missing = trades.filter((row) => !feedKeys.has(tradeKeyFromRecord(row)));
  return {
    storedFeedTransactions: transactionRows.length,
    canonicalStoredFeedTransactions: transactionRows.filter((row) => historyKeys.has(tradeKeyFromFeed(row))).length,
    staleStoredFeedTransactions: stale.length,
    missingStoredFeedTransactions: missing.length,
    staleEntries: stale.slice(0, 10),
    missingTrades: missing.slice(0, 10).map((trade) => ({
      id: trade?.id || "",
      date: trade?.date || "",
      fromTeamName: trade?.fromTeamName || "",
      toTeamName: trade?.toTeamName || "",
    })),
  };
}

function summarizeOwnershipIntegrity(leagueData = {}) {
  const rows = buildOwnershipRows(leagueData);
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, []);
    byId.get(row.id).push(row);
  }
  const duplicates = [...byId.values()].filter((locations) => locations.length > 1);
  const pickRows = buildPickRows(leagueData);
  const pickIds = new Map();
  for (const row of pickRows) {
    if (!row.id) continue;
    if (!pickIds.has(row.id)) pickIds.set(row.id, []);
    pickIds.get(row.id).push(row);
  }
  const duplicatePickIds = [...pickIds.values()].filter((locations) => locations.length > 1);
  return {
    playerLocations: rows.length,
    duplicatePlayerOwnershipCount: duplicates.length,
    duplicatePlayers: duplicates.slice(0, 15),
    pickAssets: pickRows.length,
    duplicatePickIdCount: duplicatePickIds.length,
    duplicatePickIds: duplicatePickIds.slice(0, 15),
  };
}

function summarizeRatingFreeze(leagueData = {}, baseline = null) {
  if (!baseline?.fingerprint?.ratingRows) {
    return { available: false, ok: null, changedCount: 0, changedPlayers: [] };
  }
  const before = new Map(baseline.fingerprint.ratingRows.map((row) => [row.id, row]));
  const afterRows = buildRatingRows(leagueData);
  const changed = [];
  for (const row of afterRows) {
    const previous = before.get(row.id);
    if (!previous || previous.ratingHash === row.ratingHash) continue;
    changed.push({
      id: row.id,
      name: row.name,
      before: previous.ratingProjection,
      after: row.ratingProjection,
    });
  }
  return {
    available: true,
    ok: changed.length === 0,
    beforeHash: baseline.fingerprint.ratingsHash,
    afterHash: hashString(stableStringify(afterRows.map(({ id, ratingHash }) => ({ id, ratingHash })))),
    changedCount: changed.length,
    changedPlayers: changed.slice(0, 20),
  };
}

function summarizeBankHealth(telemetry = {}, targetTrades = 0) {
  const rows = Array.isArray(telemetry?.bankHealth) ? telemetry.bankHealth : [];
  const bankSizes = rows.map((row) => finiteNumber(row?.bankSize, 0));
  return {
    observations: rows.length,
    minimumBankSize: bankSizes.length ? Math.min(...bankSizes) : 0,
    maximumBankSize: bankSizes.length ? Math.max(...bankSizes) : 0,
    emptyBankDates: rows.filter((row) => finiteNumber(row?.bankSize, 0) === 0).map((row) => row?.currentDate).filter(Boolean),
    behindPaceDates: rows.filter((row) => finiteNumber(row?.completionDeficit, 0) > 0).map((row) => ({
      currentDate: row?.currentDate || "",
      completionDeficit: finiteNumber(row?.completionDeficit, 0),
      bankSize: finiteNumber(row?.bankSize, 0),
      remainingTarget: finiteNumber(row?.remainingTarget, targetTrades),
    })),
    generationLaunches: (telemetry?.generationJobs || []).filter((row) => row?.event === "launched").length,
    generationFulfilled: (telemetry?.generationJobs || []).filter((row) => row?.event === "fulfilled").length,
    generationRejected: (telemetry?.generationJobs || []).filter((row) => row?.event === "rejected").length,
    generationTimeouts: (telemetry?.generationJobs || []).filter((row) => row?.event === "timeout").length,
    zeroCandidateGenerationPasses: (telemetry?.generationJobs || []).filter((row) => row?.event === "fulfilled" && finiteNumber(row?.candidateCount, 0) === 0).length,
    foregroundPasses: (telemetry?.generationJobs || []).filter((row) => row?.event === "foreground_pass").length,
    foregroundRuns: (telemetry?.generationJobs || []).filter((row) => row?.event === "foreground_summary").length,
    foregroundFailures: (telemetry?.generationJobs || []).filter((row) => row?.event === "foreground_failed").length,
    foregroundZeroAcceptedPasses: (telemetry?.generationJobs || []).filter(
      (row) => row?.event === "foreground_pass" && finiteNumber(row?.acceptedCount, 0) === 0
    ).length,
    foregroundReasons: (telemetry?.generationJobs || [])
      .filter((row) => row?.event === "foreground_summary")
      .reduce((counts, row) => {
        const key = String(row?.reason || "unknown");
        counts[key] = finiteNumber(counts[key], 0) + 1;
        return counts;
      }, {}),
    burstPasses: (telemetry?.passes || []).filter((row) => finiteNumber(row?.burstDepth, 0) > 0).length,
    maximumBurstDepth: (telemetry?.passes || []).reduce(
      (maxDepth, row) => Math.max(maxDepth, finiteNumber(row?.burstDepth, 0)),
      0
    ),
  };
}

function summarizeTeamCountsAndPlayers(trades = []) {
  const teamCounts = {};
  const playerCounts = {};
  for (const trade of trades) {
    for (const teamName of [trade?.fromTeamName, trade?.toTeamName].filter(Boolean)) {
      teamCounts[teamName] = finiteNumber(teamCounts[teamName], 0) + 1;
    }
    for (const playerName of assetSummaryFromTrade(trade).players) {
      playerCounts[playerName] = finiteNumber(playerCounts[playerName], 0) + 1;
    }
  }
  return {
    teamCounts: Object.fromEntries(Object.entries(teamCounts).sort((a, b) => b[1] - a[1])),
    topMovedPlayers: Object.entries(playerCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([playerName, tradeCount]) => ({ playerName, tradeCount })),
  };
}

function summarizeRepairTelemetry(telemetry = {}) {
  const repairs = Array.isArray(telemetry?.repairs) ? telemetry.repairs : [];
  const touched = {};
  for (const repair of repairs) {
    for (const teamName of repair?.touchedTeams || []) {
      touched[teamName] = finiteNumber(touched[teamName], 0) + 1;
    }
  }
  return {
    repairRuns: repairs.length,
    failedRepairs: repairs.filter((row) => row?.ok === false).length,
    targetedRepairRuns: repairs.filter((row) => row?.repairMode === "targeted_post_trade").length,
    targetedFallbackRuns: repairs.filter((row) => row?.targetedFallbackUsed === true).length,
    fullLeagueRepairRuns: repairs.filter((row) => String(row?.repairMode || "").startsWith("full_league")).length,
    totalMoves: repairs.reduce((sum, row) => sum + finiteNumber(row?.moveCount, 0), 0),
    unrelatedTeamRepairRuns: repairs.filter((row) => (row?.unrelatedTouchedTeams || []).length > 0).length,
    touchedTeamCounts: Object.fromEntries(Object.entries(touched).sort((a, b) => b[1] - a[1])),
    rows: repairs,
  };
}

function summarizeStorageAndFeed(telemetry = {}) {
  const storageWrites = telemetry?.storageWrites || [];
  const feedWrites = telemetry?.feedWrites || [];
  const bankOverlayWrites = storageWrites.filter((row) => row?.saveMode === "bank_overlay");
  const fullLeagueWrites = storageWrites.filter((row) => row?.saveMode !== "bank_overlay");
  const coveredBankStateOnlyRequests = storageWrites.reduce(
    (sum, row) => sum + finiteNumber(row?.coveredBankStateOnlyRequestCount, row?.reason === "bank_state_only" ? 1 : 0),
    0
  );
  return {
    indexedDbSaveCount: storageWrites.length,
    indexedDbSuccessfulSaves: storageWrites.filter((row) => row?.ok !== false).length,
    indexedDbFailedSaves: storageWrites.filter((row) => row?.ok === false).length,
    bankStateOnlySaves: storageWrites.filter((row) => row?.reason === "bank_state_only").length,
    coveredBankStateOnlyRequests,
    bankOverlayWrites: bankOverlayWrites.length,
    fullLeagueWrites: fullLeagueWrites.length,
    bankOverlayMs: round3(bankOverlayWrites.reduce((sum, row) => sum + finiteNumber(row?.durationMs, 0), 0)),
    fullLeagueWriteMs: round3(fullLeagueWrites.reduce((sum, row) => sum + finiteNumber(row?.durationMs, 0), 0)),
    bankStateOnlyFullLeagueWrites: storageWrites.filter(
      (row) => row?.reason === "bank_state_only" && row?.saveMode !== "bank_overlay"
    ).length,
    latestOnlyIndexedDbWrites: storageWrites.filter((row) => String(row?.mode || "").startsWith("latest_only_")).length,
    coveredSaveRequests: storageWrites.reduce((sum, row) => sum + finiteNumber(row?.coveredRequestCount, 1), 0),
    coalescedSaveRequests: storageWrites.reduce((sum, row) => sum + finiteNumber(row?.coalescedRequestCount, 0), 0),
    feedWriteCount: feedWrites.length,
    feedEntryCount: feedWrites.reduce((sum, row) => sum + finiteNumber(row?.entryCount, 0), 0),
    approximateFeedBytes: feedWrites.reduce((sum, row) => sum + finiteNumber(row?.approxBytes, 0), 0),
    feedHistorySyncWrites: feedWrites.filter((row) => row?.operation === "history_sync").length,
    feedAppendWrites: feedWrites.filter((row) => row?.operation !== "history_sync").length,
    feedWritesByReason: feedWrites.reduce((counts, row) => {
      const key = String(row?.reason || row?.operation || "append_or_mood");
      counts[key] = finiteNumber(counts[key], 0) + 1;
      return counts;
    }, {}),
  };
}

function environmentSnapshot() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  return {
    userAgent: nav?.userAgent || "",
    hardwareConcurrency: finiteNumber(nav?.hardwareConcurrency, 0),
    deviceMemoryGb: finiteNumber(nav?.deviceMemory, 0),
    language: nav?.language || "",
    pageUrl: typeof location !== "undefined" ? location.href : "",
  };
}

function percentile(values = [], p = 0.5) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return round3(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]);
}

function benchmarkResultSummary(result = {}) {
  const thresholdOf = (view) => finiteNumber(view?.teamImpact?.threshold ?? view?.threshold, 0);
  return {
    ok: Boolean(result?.ok),
    staleCode: result?.staleCode || null,
    reason: result?.reason || result?.message || "",
    requiresRosterRepairBeforeSimulation: Boolean(result?.requiresRosterRepairBeforeSimulation),
    buyerAccepted: teamViewAccepted(result?.toTeamView || {}),
    sellerAccepted: teamViewAccepted(result?.fromTeamView || {}),
    buyerScore: round3(result?.toTeamView?.score || 0),
    buyerThreshold: round3(thresholdOf(result?.toTeamView || {})),
    buyerMargin: marginForView(result?.toTeamView || {}),
    sellerScore: round3(result?.fromTeamView?.score || 0),
    sellerThreshold: round3(thresholdOf(result?.fromTeamView || {})),
    sellerMargin: marginForView(result?.fromTeamView || {}),
    executionLegal: Boolean(result?.executionValidation?.ok),
  };
}

function benchmarkDecisionMatches(expected = {}, actual = {}) {
  const expectedFrom = expected?.fromTeamView || null;
  const expectedTo = expected?.toTeamView || null;
  const equalNumber = (a, b) => Math.abs(finiteNumber(a, 0) - finiteNumber(b, 0)) < 0.0001;
  return Boolean(
    Boolean(expected?.ok) === Boolean(actual?.ok) &&
    String(expected?.staleCode || "") === String(actual?.staleCode || "") &&
    Boolean(expected?.requiresRosterRepairBeforeSimulation) === Boolean(actual?.requiresRosterRepairBeforeSimulation) &&
    (!expectedFrom || (
      Boolean(expectedFrom?.accepted) === Boolean(actual?.sellerAccepted) &&
      equalNumber(expectedFrom?.score, actual?.sellerScore) &&
      equalNumber(expectedFrom?.threshold, actual?.sellerThreshold)
    )) &&
    (!expectedTo || (
      Boolean(expectedTo?.accepted) === Boolean(actual?.buyerAccepted) &&
      equalNumber(expectedTo?.score, actual?.buyerScore) &&
      equalNumber(expectedTo?.threshold, actual?.buyerThreshold)
    ))
  );
}

export function runCpuTradePackageBenchmarks({ iterations = 7 } = {}) {
  const samples = getCpuTradeBenchmarkSamples();
  const preferred = ["simple", "rejected", "complex"]
    .map((category) => samples.find((row) => row.category === category))
    .filter(Boolean);
  const selected = preferred.length ? preferred : samples.slice(0, 3);
  const loops = Math.max(2, Math.min(25, Math.trunc(finiteNumber(iterations, 7))));

  return withCpuTradeTelemetrySuppressed(() => selected.map((sample) => {
    const durations = [];
    let finalResult = null;
    for (let index = 0; index < loops + 1; index += 1) {
      const startedAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      finalResult = validateCpuTradeCandidateOnLeague({
        leagueData: sample.leagueData,
        candidate: sample.candidate,
        currentDate: sample?.context?.currentDate || sample?.context?.generatedDate || "",
        tradeDeadlineDate: sample?.context?.tradeDeadlineDate || "",
        inOffseason: Boolean(sample?.context?.inOffseason),
        recordsByTeam:
          sample?.context?.recordsByTeam && typeof sample.context.recordsByTeam === "object"
            ? sample.context.recordsByTeam
            : null,
      });
      const finishedAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      durations.push(round3(finishedAt - startedAt));
    }
    const coldMs = durations.shift() || 0;
    const actual = benchmarkResultSummary(finalResult || {});
    return {
      category: sample.category,
      signature: sample.signature || getCpuTradeCandidateSignature(sample.candidate),
      teams: [sample?.candidate?.fromTeamName || "", sample?.candidate?.toTeamName || ""],
      package: sample.package,
      capturedPhase: sample.phase,
      iterations: loops,
      coldMs,
      warmAverageMs: durations.length ? round3(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      warmMedianMs: percentile(durations, 0.5),
      warmP95Ms: percentile(durations, 0.95),
      warmMinMs: durations.length ? Math.min(...durations) : 0,
      warmMaxMs: durations.length ? Math.max(...durations) : 0,
      expected: safeJsonClone(sample.expected),
      actual,
      decisionReplayMatch: benchmarkDecisionMatches(sample.expected, actual),
    };
  }));
}

function passFail(name, ok, details = {}) {
  return { name, status: ok === null ? "NOT_AVAILABLE" : ok ? "PASS" : "FAIL", ok, ...details };
}

export function buildCpuTradeDiagnosticReport(leagueData = {}, options = {}) {
  const telemetry = getCpuTradeTelemetrySnapshot();
  const bank = buildCpuTradeBankSummary(leagueData);
  const trades = currentSeasonCpuTrades(leagueData);
  const feed = summarizeFeedConsistency(trades);
  const quality = summarizeTradeQuality(trades);
  const integrity = summarizeOwnershipIntegrity(leagueData);
  const ratingFreeze = summarizeRatingFreeze(leagueData, telemetry?.baseline);
  const counts = summarizeTeamCountsAndPlayers(trades);
  const validation = summarizeValidationTelemetry(telemetry);
  const bankHealth = summarizeBankHealth(telemetry, bank?.targetTrades || 0);
  const repair = summarizeRepairTelemetry(telemetry);
  const io = summarizeStorageAndFeed(telemetry);
  const timings = summarizeMetrics(telemetry?.metrics || {});
  const lastSimulationPerformance = options?.lastSimulationPerformance || null;
  const deadlineDate = telemetry?.lastContext?.tradeDeadlineDate || telemetry?.baseline?.context?.tradeDeadlineDate || "";
  const postDeadlineTrades = deadlineDate
    ? trades.filter((trade) => String(trade?.date || trade?.currentDate || "") >= String(deadlineDate))
    : [];
  const benchmarkRows = options?.runBenchmarks === false
    ? []
    : runCpuTradePackageBenchmarks({ iterations: options?.benchmarkIterations || options?.iterations || 7 });
  const benchmarkReplayOk = benchmarkRows.length >= 2 && benchmarkRows.every((row) => row.decisionReplayMatch);
  const benchmarkCategories = Array.from(new Set(benchmarkRows.map((row) => row?.category).filter(Boolean)));
  const benchmarkCoverageOk = benchmarkRows.length >= 2 && benchmarkCategories.includes("rejected");
  const officialCpuTradeCount = trades.length;
  const completedByBank = finiteNumber(bank?.completedTrades ?? bank?.stats?.completedTrades, 0);
  const targetTrades = finiteNumber(bank?.targetTrades, 0);
  const minimumTrades = finiteNumber(bank?.minimumTrades, Math.max(0, targetTrades - 3));
  const remainingTarget = Math.max(0, targetTrades - completedByBank);
  const remainingMinimum = Math.max(0, minimumTrades - completedByBank);
  const maximumGenerationPasses = finiteNumber(bank?.maximumGenerationPasses, 0);
  const maximumExactEvaluations = finiteNumber(bank?.maximumExactEvaluations, 0);
  const plannedSlots = Array.isArray(leagueData?.cpuTradeBankState?.executionPlanDays)
    ? leagueData.cpuTradeBankState.executionPlanDays.length
    : 0;
  const planCursor = finiteNumber(leagueData?.cpuTradeBankState?.planCursor, 0);

  const checks = [
    passFail("Evaluator replay", benchmarkRows.length ? benchmarkReplayOk : null, {
      benchmarkCount: benchmarkRows.length,
      categories: benchmarkCategories,
    }),
    passFail("Benchmark coverage", benchmarkRows.length ? benchmarkCoverageOk : null, {
      benchmarkCount: benchmarkRows.length,
      categories: benchmarkCategories,
      requirement: "At least two real packages including one rejected package.",
    }),
    passFail("Trade count reliability", targetTrades > 0
      ? completedByBank === officialCpuTradeCount &&
        officialCpuTradeCount >= minimumTrades &&
        officialCpuTradeCount <= targetTrades
      : null, {
      officialCpuTradeCount,
      completedByBank,
      minimumTrades,
      targetTrades,
      remainingMinimum,
      remainingTarget,
    }),
    passFail("Candidate funnel telemetry", finiteNumber(bank?.stats?.generationPasses, 0) > 0, {
      generationPasses: finiteNumber(bank?.stats?.generationPasses, 0),
      proposedCandidates: finiteNumber(bank?.stats?.proposedCandidates, 0),
      exactEvaluations: finiteNumber(bank?.stats?.exactEvaluations, 0),
    }),
    passFail("Bounded continuous trade market", maximumGenerationPasses > 0 && maximumExactEvaluations > 0
      ? finiteNumber(bank?.stats?.generationPasses, 0) <= maximumGenerationPasses &&
        finiteNumber(bank?.stats?.exactEvaluations, 0) <= maximumExactEvaluations &&
        bankHealth.foregroundPasses === 0 &&
        bankHealth.foregroundRuns === 0 &&
        bankHealth.burstPasses === 0 &&
        finiteNumber(timings?.periodicRevalidationMs?.count, 0) === 0
      : null, {
      generationPasses: finiteNumber(bank?.stats?.generationPasses, 0),
      maximumGenerationPasses,
      exactEvaluations: finiteNumber(bank?.stats?.exactEvaluations, 0),
      maximumExactEvaluations,
      foregroundPasses: bankHealth.foregroundPasses,
      foregroundRuns: bankHealth.foregroundRuns,
      burstPasses: bankHealth.burstPasses,
      periodicRevalidationCalls: finiteNumber(timings?.periodicRevalidationMs?.count, 0),
    }),
    passFail("Lightweight bank persistence", io.coveredBankStateOnlyRequests > 0
      ? io.bankOverlayWrites > 0 && io.bankStateOnlyFullLeagueWrites === 0 && io.indexedDbFailedSaves === 0
      : null, {
      coveredBankStateOnlyRequests: io.coveredBankStateOnlyRequests,
      bankOverlayWrites: io.bankOverlayWrites,
      fullLeagueWrites: io.fullLeagueWrites,
      bankStateOnlyFullLeagueWrites: io.bankStateOnlyFullLeagueWrites,
      bankOverlayMs: io.bankOverlayMs,
      fullLeagueWriteMs: io.fullLeagueWriteMs,
    }),
    passFail("Trade quality records", officialCpuTradeCount > 0 ? quality.tradesWithBothTeamViews === officialCpuTradeCount : null, {
      completedTrades: officialCpuTradeCount,
      tradesWithBothTeamViews: quality.tradesWithBothTeamViews,
    }),
    passFail("Deadline enforcement", deadlineDate ? postDeadlineTrades.length === 0 : null, {
      deadlineDate,
      postDeadlineTradeCount: postDeadlineTrades.length,
    }),
    passFail("Feed/history consistency", feed.staleStoredFeedTransactions === 0 && feed.missingStoredFeedTransactions === 0 && feed.storedFeedTransactions === officialCpuTradeCount, feed),
    passFail("Ownership integrity", integrity.duplicatePlayerOwnershipCount === 0 && integrity.duplicatePickIdCount === 0, integrity),
    passFail("Roster repair", repair.repairRuns ? repair.failedRepairs === 0 : null, repair),
    passFail("Rating freeze", ratingFreeze.available ? ratingFreeze.ok : null, ratingFreeze),
  ];

  const cpuImpactCache = getCpuTradeImpactCacheStats();
  const report = {
    name: "cpu_trade_demon_report",
    diagnosticsVersion: CPU_TRADE_DIAGNOSTICS_VERSION,
    telemetryVersion: CPU_TRADE_TELEMETRY_VERSION,
    generatedAt: nowIso(),
    environment: environmentSnapshot(),
    session: {
      sessionKey: telemetry?.sessionKey || "",
      sessionStartedAt: telemetry?.sessionStartedAt || "",
      seasonYear: seasonYearOf(leagueData),
      userTeamName: telemetry?.lastContext?.userTeamName || telemetry?.baseline?.userTeamName || "",
      bankSeed: leagueData?.cpuTradeBankState?.seed || telemetry?.baseline?.bankSeed || "",
      tradeDeadlineDate: deadlineDate,
      diagnosticBaselineCaptured: Boolean(telemetry?.baseline),
      initialFingerprints: telemetry?.baseline?.fingerprint ? {
        ratingsHash: telemetry.baseline.fingerprint.ratingsHash,
        ownershipHash: telemetry.baseline.fingerprint.ownershipHash,
        picksHash: telemetry.baseline.fingerprint.picksHash,
      } : null,
      finalFingerprints: (() => {
        const fingerprint = buildCpuTradeLeagueFingerprint(leagueData);
        return {
          ratingsHash: fingerprint.ratingsHash,
          ownershipHash: fingerprint.ownershipHash,
          picksHash: fingerprint.picksHash,
        };
      })(),
    },
    summary: {
      officialCpuTradeCount,
      minimumTrades,
      targetTrades,
      completedByBank,
      remainingMinimum,
      remainingTarget,
      maximumGenerationPasses,
      maximumExactEvaluations,
      bankSize: finiteNumber(bank?.bankSize, 0),
      plannedSlots,
      planCursor,
      generationPasses: finiteNumber(bank?.stats?.generationPasses, 0),
      proposedCandidates: finiteNumber(bank?.stats?.proposedCandidates, 0),
      exactEvaluations: finiteNumber(bank?.stats?.exactEvaluations, 0),
      cachedAdmissionRejections: finiteNumber(bank?.stats?.cachedAdmissionRejections, 0),
      sameStateValidationCacheHits: finiteNumber(bank?.stats?.sameStateValidationCacheHits, 0),
      sameStateAdmissionCacheHits: finiteNumber(bank?.stats?.sameStateAdmissionCacheHits, 0),
      sameStatePeriodicCacheHits: finiteNumber(bank?.stats?.sameStatePeriodicCacheHits, 0),
      recordSnapshotValidationCalls: finiteNumber(bank?.stats?.recordSnapshotValidationCalls, 0),
      acceptedIntoBank: finiteNumber(bank?.stats?.acceptedIntoBank, 0),
      rejectedCandidates: finiteNumber(bank?.stats?.rejectedCandidates, 0),
      executionAttempts: finiteNumber(bank?.stats?.executionAttempts, 0),
      executionDeferrals: finiteNumber(bank?.stats?.executionDeferrals, 0),
      completedTrades: finiteNumber(bank?.stats?.completedTrades, 0),
      processingMs: round3(bank?.stats?.processingMs || 0),
      storedFeedTransactions: feed.storedFeedTransactions,
      canonicalStoredFeedTransactions: feed.canonicalStoredFeedTransactions,
      staleStoredFeedTransactions: feed.staleStoredFeedTransactions,
      postDeadlineTradeCount: postDeadlineTrades.length,
      simulationElapsedMs: finiteNumber(lastSimulationPerformance?.elapsedMs, 0),
      simulationCpuTradePasses: finiteNumber(lastSimulationPerformance?.cpuTradePasses, 0),
      simulationCpuTradeMs: finiteNumber(lastSimulationPerformance?.cpuTradeMs, 0),
      totalCpuTradeProcessingMs: finiteNumber(timings?.totalCpuTradeProcessingMs?.totalMs, 0),
      workerGenerationMs: finiteNumber(timings?.workerGenerationMs?.totalMs, 0),
      foregroundGenerationMs: finiteNumber(timings?.foregroundGenerationMs?.totalMs, 0),
      parallelGenerationBatchMs: finiteNumber(timings?.parallelGenerationBatchMs?.totalMs, 0),
      foregroundParallelGenerationBatchMs: finiteNumber(timings?.foregroundParallelGenerationBatchMs?.totalMs, 0),
      parallelGenerationBatches: (telemetry?.generationJobs || []).filter((row) => row?.event === "parallel_batch_summary").length,
      parallelGenerationPassesUsed: (telemetry?.generationJobs || []).filter((row) => row?.event === "parallel_foreground_pass_used").length,
      parallelGenerationPassFallbacks: (telemetry?.generationJobs || []).filter((row) => row?.event === "parallel_foreground_pass_fallback").length,
      parallelGenerationPassesDiscarded: (telemetry?.generationJobs || []).reduce(
        (sum, row) => sum + (row?.event === "parallel_foreground_passes_discarded" ? finiteNumber(row?.count, 0) : 0),
        0
      ),
      exactValidationMs: finiteNumber(timings?.exactValidationMs?.totalMs, 0),
      parallelValidationWallMs: finiteNumber(timings?.parallelValidationWallMs?.totalMs, 0),
      parallelValidationWorkerComputeMs: finiteNumber(timings?.parallelValidationWorkerComputeMs?.totalMs, 0),
      parallelValidationSnapshotSyncMs: finiteNumber(timings?.parallelValidationSnapshotSyncMs?.totalMs, 0),
      parallelValidationFallbacks: finiteNumber(timings?.parallelValidationFallbackMs?.count, 0),
      recordBuildMs: finiteNumber(timings?.recordBuildMs?.totalMs, 0),
      rosterRepairMs: finiteNumber(timings?.rosterRepairMs?.totalMs, 0),
      feedSyncMs: finiteNumber(timings?.feedSyncMs?.totalMs, 0),
      feedHistorySyncMs: finiteNumber(timings?.feedHistorySyncMs?.totalMs, 0),
      storageMs: finiteNumber(timings?.storageMs?.totalMs, 0),
      storageBankOverlayWrites: finiteNumber(io?.bankOverlayWrites, 0),
      storageFullLeagueWrites: finiteNumber(io?.fullLeagueWrites, 0),
      storageBankOverlayMs: finiteNumber(io?.bankOverlayMs, 0),
      storageFullLeagueWriteMs: finiteNumber(io?.fullLeagueWriteMs, 0),
      storageCoveredBankStateOnlyRequests: finiteNumber(io?.coveredBankStateOnlyRequests, 0),
      benchmarkCaptureMs: finiteNumber(timings?.benchmarkCaptureMs?.totalMs, 0),
      cpuImpactCacheHits: finiteNumber(cpuImpactCache?.hits, 0),
      cpuImpactCacheMisses: finiteNumber(cpuImpactCache?.misses, 0),
      cpuImpactCacheSize: finiteNumber(cpuImpactCache?.size, 0),
    },
    checks,
    ok: checks.every((row) => row.status !== "FAIL"),
    bank,
    candidateFunnel: {
      generated: finiteNumber(bank?.stats?.proposedCandidates, 0),
      duplicateCandidates: finiteNumber(bank?.stats?.duplicateCandidates, 0),
      exactValidated: finiteNumber(bank?.stats?.exactEvaluations, 0),
      maximumGenerationPasses,
      maximumExactEvaluations,
      periodicRevalidationCalls: finiteNumber(timings?.periodicRevalidationMs?.count, 0),
      sameStateValidationCacheHits: finiteNumber(bank?.stats?.sameStateValidationCacheHits, 0),
      sameStateAdmissionCacheHits: finiteNumber(bank?.stats?.sameStateAdmissionCacheHits, 0),
      sameStatePeriodicCacheHits: finiteNumber(bank?.stats?.sameStatePeriodicCacheHits, 0),
      recordSnapshotValidationCalls: finiteNumber(bank?.stats?.recordSnapshotValidationCalls, 0),
      acceptedIntoBank: finiteNumber(bank?.stats?.acceptedIntoBank, 0),
      rejected: finiteNumber(bank?.stats?.rejectedCandidates, 0),
      staleRemoved: finiteNumber(bank?.stats?.staleCandidatesRemoved, 0),
      executionAttempts: finiteNumber(bank?.stats?.executionAttempts, 0),
      executionDeferrals: finiteNumber(bank?.stats?.executionDeferrals, 0),
      completed: officialCpuTradeCount,
      foregroundPasses: bankHealth.foregroundPasses,
      foregroundRuns: bankHealth.foregroundRuns,
      foregroundZeroAcceptedPasses: bankHealth.foregroundZeroAcceptedPasses,
      burstPasses: bankHealth.burstPasses,
      rejectionReasons: bank?.rejectionReasons || {},
    },
    validation,
    cpuImpactCache,
    bankHealth,
    timings,
    generationJobs: telemetry?.generationJobs || [],
    tradeQuality: quality,
    feedConsistency: feed,
    integrity,
    ratingFreeze,
    rosterRepair: repair,
    io,
    teamCounts: counts.teamCounts,
    topMovedPlayers: counts.topMovedPlayers,
    packageBenchmarks: benchmarkRows,
    lastSimulationPerformance,
    postDeadlineTrades,
    rawTelemetry: options?.includeRawTelemetry ? telemetry : undefined,
  };
  return report;
}

export function resetCpuTradeDiagnostics() {
  return resetCpuTradeTelemetry({ note: "bmDiag.cpuTradeReset" });
}

export function saveCpuTradeBaselineReport(report, label = "pre_optimization") {
  const payload = {
    label: String(label || "pre_optimization"),
    savedAt: nowIso(),
    report: safeJsonClone(report),
  };
  try {
    localStorage.setItem(CPU_TRADE_BASELINE_REPORT_KEY, JSON.stringify(payload));
  } catch {}
  return payload;
}

export function readCpuTradeBaselineReport() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CPU_TRADE_BASELINE_REPORT_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function percentageChange(before, after) {
  if (!Number.isFinite(Number(before)) || Number(before) === 0) return null;
  return round3(((Number(after) - Number(before)) / Number(before)) * 100);
}

export function compareCpuTradeDiagnosticReports(currentReport, baselinePayload = readCpuTradeBaselineReport()) {
  const baseline = baselinePayload?.report || baselinePayload;
  if (!baseline || !currentReport) {
    return {
      ok: false,
      reason: "missing_report",
      baselineAvailable: Boolean(baseline),
      currentAvailable: Boolean(currentReport),
    };
  }

  const before = baseline.summary || {};
  const after = currentReport.summary || {};
  const benchmarkBefore = new Map((baseline.packageBenchmarks || []).map((row) => [row.signature, row]));
  const packageComparisons = (currentReport.packageBenchmarks || []).map((row) => {
    const old = benchmarkBefore.get(row.signature);
    return {
      signature: row.signature,
      category: row.category,
      baselineFound: Boolean(old),
      decisionSame: old ? stableStringify(old.actual) === stableStringify(row.actual) : null,
      baselineWarmMedianMs: old?.warmMedianMs ?? null,
      currentWarmMedianMs: row.warmMedianMs,
      warmMedianChangePct: old ? percentageChange(old.warmMedianMs, row.warmMedianMs) : null,
    };
  });

  const completionRate = (summary = {}) =>
    finiteNumber(summary?.completedByBank, 0) / Math.max(1, finiteNumber(summary?.targetTrades, 1));
  const tradeShare = (count, total) => finiteNumber(count, 0) / Math.max(1, finiteNumber(total, 0));
  const packageMixDistance = (a = {}, b = {}) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    const totalA = Object.values(a || {}).reduce((sum, value) => sum + finiteNumber(value, 0), 0);
    const totalB = Object.values(b || {}).reduce((sum, value) => sum + finiteNumber(value, 0), 0);
    let distance = 0;
    for (const key of keys) {
      distance += Math.abs(
        tradeShare(a?.[key], totalA) -
        tradeShare(b?.[key], totalB)
      );
    }
    return round3(distance / 2);
  };

  const beforeQuality = baseline?.tradeQuality || {};
  const afterQuality = currentReport?.tradeQuality || {};
  const beforeCompleted = finiteNumber(beforeQuality?.completedTrades, before?.officialCpuTradeCount);
  const afterCompleted = finiteNumber(afterQuality?.completedTrades, after?.officialCpuTradeCount);

  const behavior = {
    baselineCompletionRate: round3(completionRate(before)),
    currentCompletionRate: round3(completionRate(after)),
    targetCompletionDelta: round3(completionRate(after) - completionRate(before)),
    officialTradeCountDelta: finiteNumber(after.officialCpuTradeCount, 0) - finiteNumber(before.officialCpuTradeCount, 0),
    remainingTargetDelta: finiteNumber(after.remainingTarget, 0) - finiteNumber(before.remainingTarget, 0),
    executionDeferralsDelta: finiteNumber(after.executionDeferrals, 0) - finiteNumber(before.executionDeferrals, 0),
    staleFeedDelta: finiteNumber(after.staleStoredFeedTransactions, 0) - finiteNumber(before.staleStoredFeedTransactions, 0),
    postDeadlineTradeDelta: finiteNumber(after.postDeadlineTradeCount, 0) - finiteNumber(before.postDeadlineTradeCount, 0),
    qualityAverageMarginDelta: round3(
      finiteNumber(afterQuality?.averageDecisionMargin, 0) -
      finiteNumber(beforeQuality?.averageDecisionMargin, 0)
    ),
    qualityMedianMinimumMarginDelta: round3(
      finiteNumber(afterQuality?.medianMinimumMargin, 0) -
      finiteNumber(beforeQuality?.medianMinimumMargin, 0)
    ),
    qualityP10MinimumMarginDelta: round3(
      finiteNumber(afterQuality?.p10MinimumMargin, 0) -
      finiteNumber(beforeQuality?.p10MinimumMargin, 0)
    ),
    qualityWorstMarginDelta: round3(
      finiteNumber(afterQuality?.worstMinimumMargin, 0) -
      finiteNumber(beforeQuality?.worstMinimumMargin, 0)
    ),
    borderlineTradeShareDelta: round3(
      tradeShare(afterQuality?.borderlineTrades, afterCompleted) -
      tradeShare(beforeQuality?.borderlineTrades, beforeCompleted)
    ),
    pickTradeShareDelta: round3(
      tradeShare(afterQuality?.pickTrades, afterCompleted) -
      tradeShare(beforeQuality?.pickTrades, beforeCompleted)
    ),
    packageMixDistance: packageMixDistance(beforeQuality?.packageMix, afterQuality?.packageMix),
  };

  const performance = {
    simulationElapsedChangePct: percentageChange(before.simulationElapsedMs, after.simulationElapsedMs),
    simulationCpuTradeMsChangePct: percentageChange(before.simulationCpuTradeMs, after.simulationCpuTradeMs),
    processingMsChangePct: percentageChange(before.processingMs, after.processingMs),
    totalCpuTradeProcessingMsChangePct: percentageChange(before.totalCpuTradeProcessingMs, after.totalCpuTradeProcessingMs),
    workerGenerationMsChangePct: percentageChange(before.workerGenerationMs, after.workerGenerationMs),
    foregroundGenerationMsChangePct: percentageChange(before.foregroundGenerationMs, after.foregroundGenerationMs),
    exactValidationMsChangePct: percentageChange(before.exactValidationMs, after.exactValidationMs),
    recordBuildMsChangePct: percentageChange(before.recordBuildMs, after.recordBuildMs),
    rosterRepairMsChangePct: percentageChange(before.rosterRepairMs, after.rosterRepairMs),
    feedHistorySyncMsChangePct: percentageChange(before.feedHistorySyncMs, after.feedHistorySyncMs),
    storageMsChangePct: percentageChange(before.storageMs, after.storageMs),
    exactEvaluationsChangePct: percentageChange(before.exactEvaluations, after.exactEvaluations),
    proposedCandidatesChangePct: percentageChange(before.proposedCandidates, after.proposedCandidates),
  };

  const evaluatorReplayOk =
    packageComparisons.length > 0 &&
    packageComparisons.every((row) => row.baselineFound && row.decisionSame === true);
  const quantityReliable =
    finiteNumber(after.completedByBank, 0) === finiteNumber(after.officialCpuTradeCount, 0) &&
    finiteNumber(after.remainingTarget, 0) <= 3 &&
    completionRate(after) >= Math.min(1, completionRate(before) - 0.05);
  const qualityWithinTolerance =
    Math.abs(behavior.qualityAverageMarginDelta) <= 1 &&
    behavior.qualityWorstMarginDelta >= -1.5 &&
    Math.abs(behavior.borderlineTradeShareDelta) <= 0.15 &&
    Math.abs(behavior.pickTradeShareDelta) <= 0.2 &&
    behavior.packageMixDistance <= 0.4;
  const deadlineSafe = finiteNumber(after.postDeadlineTradeCount, 0) === 0;
  const feedSafe =
    finiteNumber(after.staleStoredFeedTransactions, 0) === 0 &&
    finiteNumber(after.storedFeedTransactions, 0) === finiteNumber(after.officialCpuTradeCount, 0);
  const stateSafe =
    currentReport?.ratingFreeze?.ok !== false &&
    currentReport?.integrity?.duplicatePlayerOwnershipCount === 0 &&
    currentReport?.integrity?.duplicatePickIdCount === 0 &&
    currentReport?.rosterRepair?.failedRepairs === 0;

  const checks = [
    passFail("Evaluator replay unchanged", evaluatorReplayOk, { packageComparisons }),
    passFail("Trade quantity reliability unchanged", quantityReliable, {
      baselineCompletionRate: behavior.baselineCompletionRate,
      currentCompletionRate: behavior.currentCompletionRate,
      completedByBank: after.completedByBank,
      officialCpuTradeCount: after.officialCpuTradeCount,
      remainingTarget: after.remainingTarget,
    }),
    passFail("Trade quality distribution comparable", qualityWithinTolerance, {
      averageMarginDelta: behavior.qualityAverageMarginDelta,
      worstMarginDelta: behavior.qualityWorstMarginDelta,
      borderlineShareDelta: behavior.borderlineTradeShareDelta,
      pickShareDelta: behavior.pickTradeShareDelta,
      packageMixDistance: behavior.packageMixDistance,
    }),
    passFail("Deadline safety unchanged", deadlineSafe, {
      postDeadlineTradeCount: after.postDeadlineTradeCount,
    }),
    passFail("Feed and history consistency unchanged", feedSafe, {
      storedFeedTransactions: after.storedFeedTransactions,
      officialCpuTradeCount: after.officialCpuTradeCount,
      staleStoredFeedTransactions: after.staleStoredFeedTransactions,
    }),
    passFail("Ratings, ownership, picks, and roster repair safe", stateSafe, {
      ratingFreeze: currentReport?.ratingFreeze,
      integrity: currentReport?.integrity,
      rosterRepair: currentReport?.rosterRepair,
    }),
  ];

  return {
    name: "cpu_trade_before_after_comparison",
    diagnosticsVersion: CPU_TRADE_DIAGNOSTICS_VERSION,
    generatedAt: nowIso(),
    baselineLabel: baselinePayload?.label || "baseline",
    ok: checks.every((row) => row.status === "PASS"),
    checks,
    behavior,
    performance,
    packageComparisons,
    baselineSummary: before,
    currentSummary: after,
  };
}

