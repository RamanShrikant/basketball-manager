import { evaluateTradeTeamImpact } from "./tradeTeamImpact.js";
import {
  evaluateTradeFinancialLegality,
  getPlayerSalary,
  sideSalary,
  validateTradeForExecution,
} from "./tradeExecution.js";
import {
  canAddCustomProtectionToPick,
  getAllTeamsFromLeague,
  getTradePickBaseProtectionLabel,
  getTradeablePickOwnedRange,
  isResolvedDraftPickAsset,
  isSwapDraftPickAsset,
  normalizeDraftPicks,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  sortDraftPickAssets,
  validateCustomPickProtection,
} from "./draftPicks.js";

const DEFAULT_PICK_PROTECTION = "Unprotected";
const MAX_SIDE_ITEMS = 8;
const COMFORT_FLOOR = 0.16;
const TARGET_COMFORT_MARGIN = 0.48;
const MAX_PLAYER_CANDIDATES = 12;
const MAX_PICK_CANDIDATES = 10;
const MAX_BASE_PACKAGES_PER_TEAM = 30;
const MAX_BALANCE_ROUNDS = 2;
const MAX_ACCEPTED_BASE_SEEDS = 3;
const MAX_EVALUATIONS_PER_TEAM = 36;
const BASE_EVAL_MIN_BEFORE_EARLY_STOP = 10;
const GOOD_ENOUGH_SCORE = 9.0;


const TRADE_FINDER_DEBUG_KEY = "bm_trade_finder_debug_v1";
const TRADE_FINDER_FAST_SCAN_KEY = "bm_trade_finder_fast_scan_v1";
const TRADE_FINDER_SLOW_EVAL_MS = 80;
const TRADE_FINDER_SLOW_TEAM_MS = 350;

function isTradeFinderDebugEnabled() {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        (window.__TF_DEBUG || window.__debugTradeFinder || localStorage.getItem(TRADE_FINDER_DEBUG_KEY) === "1")
    );
  } catch {
    return false;
  }
}

function getTradeFinderFastScanMode() {
  try {
    if (typeof window === "undefined") return "scan_rescue";
    const stored = localStorage.getItem(TRADE_FINDER_FAST_SCAN_KEY);
    const raw = String(stored || "").toLowerCase().trim();

    // Default Trade Finder searches to the fast scan + rescue path.
    // LocalStorage can still override this for debugging/comparison.
    if (!raw) return "scan_rescue";
    if (["0", "off", "false", "exact", "slow", "none"].includes(raw)) return "off";
    if (["1", "on", "true", "scan", "fast", "fast_scan"].includes(raw)) return "scan";
    if (["scan_rescue", "scan+rescue", "rescue"].includes(raw)) return "scan_rescue";
    return "scan_rescue";
  } catch {
    return "scan_rescue";
  }
}

function shouldUseTradeFinderFastScanImpactForProfile(profile = null) {
  const mode = getTradeFinderFastScanMode();
  if (mode === "off") return false;
  const phase = String(profile?.searchPhase || "").toLowerCase();
  if (phase === "scan") return true;
  if (mode === "scan_rescue" && phase === "rescue") return true;
  return false;
}

function tfDebugNow() {
  try {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

function tfRoundMs(value) {
  const n = Number(value || 0);
  return Math.round(n * 10) / 10;
}

function tfDebugLog(label, payload = null) {
  if (!isTradeFinderDebugEnabled()) return;
  if (payload === null || payload === undefined) console.log(`[TF DEBUG] ${label}`);
  else console.log(`[TF DEBUG] ${label}`, payload);
}

function tfItemsLabel(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const players = rows.filter((item) => item?.type === "player").length;
  const picks = rows.filter((item) => item?.type === "pick").length;
  return `${rows.length} assets (${players} players, ${picks} picks)`;
}



function countTradeFinderItemTypes(items = []) {
  const rows = Array.isArray(items) ? items : [];
  return {
    assetCount: rows.length,
    playerCount: rows.filter((item) => item?.type === "player").length,
    pickCount: rows.filter((item) => item?.type === "pick").length,
  };
}

function getHighestSelectedPlayerOverall(items = []) {
  const players = (Array.isArray(items) ? items : [])
    .filter((item) => item?.type === "player")
    .map((item) => Number(item?.player?.overall || item?.player?.ovr || 0))
    .filter((value) => Number.isFinite(value));
  return players.length ? Math.max(...players) : 0;
}

function getSearchModeName(searchMode = "accurate") {
  const raw = String(searchMode || "accurate").toLowerCase();
  if (["fast", "preview", "fast_preview", "quick"].includes(raw)) return "fast_preview";
  if (["accurate", "deep", "balanced", "full"].includes(raw)) return "accurate";
  return "accurate";
}


function getTradeFinderRefineMode() {
  try {
    if (typeof window === "undefined") return "ultra_fast";
    const raw = String(localStorage.getItem("bm_trade_finder_refine_mode_v1") || "").toLowerCase().trim();

    // Default to the speed-capped refine pass. The safer balanced refine path
    // is still available by setting localStorage to "balanced" for testing.
    if (!raw) return "ultra_fast";
    if (["ultra", "ultra_fast", "speed", "under60"].includes(raw)) return "ultra_fast";
    if (["off", "none", "scan_only"].includes(raw)) return "scan_only";
    return "balanced";
  } catch {
    return "ultra_fast";
  }
}

function getTradeFinderRefineSettings() {
  const mode = getTradeFinderRefineMode();
  if (mode === "ultra_fast") {
    return {
      mode,
      policy: "ultra_fast_top_4_eval_cap_3_always_rescue",
      limitHighValue: 4,
      limitStandard: 5,
      evalCap: 3,
      basePackageCap: 10,
      maxBalanceRounds: 1,
      maxPickRecoveryCandidates: 1,
      perTeamBudgetMs: 3200,
      refineTimeBudgetMs: 9000,
      priorityMode: "pick_underpay_first",
    };
  }
  if (mode === "scan_only") {
    return {
      mode,
      policy: "scan_rescue_no_refine_debug_only",
      limitHighValue: 0,
      limitStandard: 0,
      evalCap: 0,
      basePackageCap: 0,
      maxBalanceRounds: 0,
      maxPickRecoveryCandidates: 0,
      perTeamBudgetMs: 0,
      refineTimeBudgetMs: 0,
      priorityMode: "none",
    };
  }
  return {
    mode: "balanced",
    policy: "top_6_eval_cap_4_always_rescue",
    limitHighValue: 6,
    limitStandard: 8,
    evalCap: 4,
    basePackageCap: 12,
    maxBalanceRounds: 1,
    maxPickRecoveryCandidates: 1,
    perTeamBudgetMs: 4200,
    refineTimeBudgetMs: 0,
    priorityMode: "balanced_score",
  };
}

function getTradeFinderSearchProfile(selectedItems = [], leagueData = null, searchMode = "accurate") {
  const counts = countTradeFinderItemTypes(selectedItems);
  const mode = getSearchModeName(searchMode);
  const selectedValue = packageValue(selectedItems, leagueData);
  const highestOverall = getHighestSelectedPlayerOverall(selectedItems);
  const isSuperstarPackage = highestOverall >= 90 || selectedValue >= 100;
  const isHighValuePackage = selectedValue >= 85 || highestOverall >= 87;

  if (mode === "fast_preview") {
    if (isSuperstarPackage) {
      return {
        name: "superstar_fast_preview",
        mode,
        reason: "90+ OVR or 100+ value package fast preview",
        maxEvaluationsPerTeam: 4,
        maxBasePackagesPerTeam: 16,
        maxBalanceRounds: 0,
        maxAcceptedBaseSeeds: 1,
        baseEvalMinBeforeEarlyStop: 0,
        goodEnoughScore: 999,
        stopAfterFirstAccepted: true,
        firstAcceptedImmediate: true,
        forcePickRecovery: false,
        preferPicksForHighValue: true,
        maxPickRecoveryCandidates: 0,
        minOfferGapForFairness: -24,
        perTeamBudgetMs: 2200,
        maxSearchMs: 12000,
        missRisk: "high",
      };
    }

    if (counts.playerCount >= 3 || counts.assetCount >= 3) {
      return {
        name: "large_package_fast_preview",
        mode,
        reason: "3+ outgoing assets fast preview",
        maxEvaluationsPerTeam: 8,
        maxBasePackagesPerTeam: 18,
        maxBalanceRounds: 0,
        maxAcceptedBaseSeeds: 1,
        baseEvalMinBeforeEarlyStop: 0,
        goodEnoughScore: 999,
        stopAfterFirstAccepted: true,
        firstAcceptedImmediate: true,
        forcePickRecovery: false,
        preferPicksForHighValue: isHighValuePackage,
        maxPickRecoveryCandidates: 0,
        minOfferGapForFairness: -22,
        perTeamBudgetMs: 2600,
        maxSearchMs: 14000,
        missRisk: "medium_high",
      };
    }

    return {
      name: counts.assetCount >= 2 ? "medium_fast_preview" : "standard_fast_preview",
      mode,
      reason: "quick first-pass preview",
      maxEvaluationsPerTeam: counts.assetCount >= 2 ? 8 : 10,
      maxBasePackagesPerTeam: counts.assetCount >= 2 ? 18 : 20,
      maxBalanceRounds: 0,
      maxAcceptedBaseSeeds: 1,
      baseEvalMinBeforeEarlyStop: 0,
      goodEnoughScore: 999,
      stopAfterFirstAccepted: true,
      firstAcceptedImmediate: true,
      forcePickRecovery: false,
      preferPicksForHighValue: isHighValuePackage,
      maxPickRecoveryCandidates: 0,
      minOfferGapForFairness: -20,
      perTeamBudgetMs: 2500,
      maxSearchMs: 14000,
      missRisk: "medium",
    };
  }

  // Accurate mode is still bounded. It is not allowed to run the old 5-minute
  // standard_deep path forever. Superstar/high-value packages get a fairness
  // recovery pass that tries to add picks instead of accepting quick CPU-lowball offers.
  if (isSuperstarPackage) {
    return {
      name: "superstar_single_fair",
      mode,
      reason: "90+ OVR or 100+ value package needs fairness + pick recovery",
      maxEvaluationsPerTeam: 18,
      maxBasePackagesPerTeam: 30,
      maxBalanceRounds: 2,
      maxAcceptedBaseSeeds: 3,
      baseEvalMinBeforeEarlyStop: 6,
      goodEnoughScore: 7.5,
      stopAfterFirstAccepted: false,
      firstAcceptedImmediate: false,
      forcePickRecovery: true,
      preferPicksForHighValue: true,
      maxPickRecoveryCandidates: 7,
      minOfferGapForFairness: -16,
      perTeamBudgetMs: 6200,
      maxSearchMs: 0,
      missRisk: "low_medium",
    };
  }

  if (counts.playerCount >= 3 || counts.assetCount >= 3) {
    return {
      name: "large_package_balanced",
      mode,
      reason: "3+ outgoing assets bounded accurate search",
      maxEvaluationsPerTeam: 16,
      maxBasePackagesPerTeam: 26,
      maxBalanceRounds: 1,
      maxAcceptedBaseSeeds: 2,
      baseEvalMinBeforeEarlyStop: 4,
      goodEnoughScore: 9.5,
      stopAfterFirstAccepted: false,
      firstAcceptedImmediate: false,
      forcePickRecovery: isHighValuePackage,
      preferPicksForHighValue: isHighValuePackage,
      maxPickRecoveryCandidates: isHighValuePackage ? 5 : 3,
      minOfferGapForFairness: -20,
      perTeamBudgetMs: 5200,
      maxSearchMs: 0,
      missRisk: "low_medium",
    };
  }

  if (counts.playerCount >= 2 || counts.assetCount >= 2) {
    return {
      name: "medium_package_balanced",
      mode,
      reason: "2 outgoing assets bounded balanced search",
      maxEvaluationsPerTeam: 16,
      maxBasePackagesPerTeam: 24,
      maxBalanceRounds: 1,
      maxAcceptedBaseSeeds: 2,
      baseEvalMinBeforeEarlyStop: 5,
      goodEnoughScore: 10,
      stopAfterFirstAccepted: false,
      firstAcceptedImmediate: false,
      forcePickRecovery: isHighValuePackage,
      preferPicksForHighValue: isHighValuePackage,
      maxPickRecoveryCandidates: isHighValuePackage ? 4 : 2,
      minOfferGapForFairness: -20,
      perTeamBudgetMs: 4800,
      maxSearchMs: 0,
      missRisk: "low_medium",
    };
  }

  return {
    name: "standard_bounded",
    mode,
    reason: "single non-superstar asset bounded search",
    maxEvaluationsPerTeam: 18,
    maxBasePackagesPerTeam: 26,
    maxBalanceRounds: 1,
    maxAcceptedBaseSeeds: 2,
    baseEvalMinBeforeEarlyStop: 7,
    goodEnoughScore: GOOD_ENOUGH_SCORE,
    stopAfterFirstAccepted: false,
    firstAcceptedImmediate: false,
    forcePickRecovery: false,
    preferPicksForHighValue: false,
    maxPickRecoveryCandidates: 2,
    minOfferGapForFairness: -22,
    perTeamBudgetMs: 4600,
    maxSearchMs: 0,
    missRisk: "low_medium",
  };
}

function getEvalLimit(evalState = null) {
  return Number(evalState?.profile?.maxEvaluationsPerTeam || MAX_EVALUATIONS_PER_TEAM);
}

function hasTeamTimeBudgetExpired(evalState = null) {
  const budget = Number(evalState?.profile?.perTeamBudgetMs || 0);
  const startedAt = Number(evalState?.teamStartedAt || 0);
  return budget > 0 && startedAt > 0 && tfDebugNow() - startedAt >= budget;
}

function hasSearchTimeBudgetExpired(evalState = null) {
  const budget = Number(evalState?.profile?.maxSearchMs || 0);
  const startedAt = Number(evalState?.searchStartedAt || 0);
  return budget > 0 && startedAt > 0 && tfDebugNow() - startedAt >= budget;
}

const TRADE_FINDER_YIELD_EVERY_EVALUATIONS = 2;

function isTradeFinderSearchCancelled(signal = null) {
  try {
    if (signal?.aborted) return true;
    if (signal?.cancelled) return true;
    if (signal?.current === true) return true;
  } catch {}
  return false;
}

function tfYieldToBrowser(metrics = null) {
  const startedAt = tfDebugNow();
  return new Promise((resolve) => {
    // Do not use requestAnimationFrame here. In background/throttled tabs RAF can
    // pause for many seconds, which made Trade Finder look like the logic was slow
    // even when the actual trade-impact work had already finished.
    setTimeout(() => {
      const yieldMs = tfDebugNow() - startedAt;
      if (metrics) metrics.yieldMs = Number(metrics.yieldMs || 0) + yieldMs;
      resolve();
    }, 0);
  });
}

function tfSafeProgress(callback, payload) {
  if (typeof callback !== "function") return;
  try {
    callback(payload);
  } catch {}
}


function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getSeasonYearFromLeague(leagueData) {
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const candidates = [
    offseasonState?.seasonYear,
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonStartYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  return candidates.length ? Math.max(...candidates) : 2026;
}

function readLockedDraftOrder(leagueData, seasonYear) {
  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return direct;

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (Array.isArray(lotteryOrder) && lotteryOrder.length) return lotteryOrder;

  const savedLottery = safeJSON(localStorage.getItem("bm_draft_lottery_v1"), null);
  if (
    savedLottery &&
    Number(savedLottery.seasonYear) === Number(seasonYear) &&
    savedLottery.firstRoundRevealed &&
    savedLottery.secondRoundRevealed &&
    Array.isArray(savedLottery?.result?.fullDraftOrder)
  ) {
    return savedLottery.result.fullDraftOrder;
  }

  return [];
}

function isDraftCompleteForSeason(leagueData, seasonYear) {
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const savedDraftState = safeJSON(localStorage.getItem("bm_draft_state_v1"), null);

  return Boolean(
    (Number(offseasonState?.seasonYear || seasonYear) === Number(seasonYear) && offseasonState?.draftComplete) ||
      (Number(savedDraftState?.seasonYear || 0) === Number(seasonYear) && savedDraftState?.completed) ||
      (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed)
  );
}

function getPickOwnerName(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.teamName || row.ownerTeam || row.owner || "";
}

function getPickOriginalName(row = {}) {
  return row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.originalTeam || row.teamName || "";
}

function buildResolvedDraftAsset(row = {}, seasonYear) {
  const pickNumber = Number(row.pick || row.pickNumber || row.overallPick || row.draftPickNumber || row.resolvedPickNumber || 0);
  const round = Number(row.round || (pickNumber <= 30 ? 1 : 2));
  const ownerTeam = getPickOwnerName(row);
  const originalTeam = getPickOriginalName(row);

  return {
    id: `resolved_${seasonYear}_${round}_${pickNumber}_${ownerTeam}_${originalTeam}`,
    assetType: "resolved",
    type: "resolved",
    year: Number(seasonYear),
    round,
    pickNumber,
    overallPick: pickNumber,
    resolvedPickNumber: pickNumber,
    projectedRank: pickNumber || undefined,
    currentSeasonYear: Number(seasonYear),
    leagueSeasonYear: Number(seasonYear),
    originalTeam,
    originalTeamName: originalTeam,
    ownerTeam,
    owner: ownerTeam,
    currentOwnerTeamName: ownerTeam,
    displayProtection: "Resolved",
    protection: "Resolved",
    protections: "Resolved",
    status: "active",
    notes: row.draftPickProtection || row.swapProtectionLabel || "Resolved draft pick",
  };
}

function collectTradeablePicksForTeam(leagueData, teamName) {
  if (!leagueData || !teamName) return [];

  const teamNames = getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
  const seasonYear = getSeasonYearFromLeague(leagueData);
  const draftOrder = readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = draftOrder.length >= 60;

  const futurePicks = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
    .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .map((pick) => ({
      ...pick,
      currentSeasonYear: seasonYear,
      leagueSeasonYear: seasonYear,
    }));

  const resolvedPicks = draftOrderLocked && !draftComplete
    ? draftOrder.map((row) => buildResolvedDraftAsset(row, seasonYear))
    : [];

  const activeKey = normalizeTeamName(teamName);
  const seen = new Set();
  return [...resolvedPicks, ...futurePicks]
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "") === activeKey)
    .sort(sortDraftPickAssets)
    .filter((pick) => {
      const key = pickKey(pick);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTeamName(team = {}) {
  return team?.name || team?.teamName || "";
}

function sameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function getTeamPlayers(team) {
  return Array.isArray(team?.players) ? team.players : [];
}

function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

function playerKey(player = {}) {
  return String(player.id ?? player.playerId ?? player.name ?? playerNameOf(player));
}

function pickKey(pick = {}) {
  const rule = pick.tradeRule || {};
  if (rule.swapId) return `swap:${rule.swapId}:${rule.mirror ? "mirror" : "primary"}`;
  return String(
    pick.id ||
      pick.pickId ||
      `${pick.assetType || pick.type || "pick"}:${pick.year || ""}:${pick.round || ""}:${pick.originalTeam || pick.originalTeamName || ""}:${pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || ""}:${getTradePickBaseProtectionLabel(pick)}`
  );
}

function itemKey(item = {}) {
  if (item.type === "player") return `player:${playerKey(item.player)}`;
  if (item.type === "pick") {
    const pick = item.pick || {};
    const rule = item.tradeRule || pick.tradeRule || {};
    if (rule.swapId) return `swap:${rule.swapId}:${rule.mirror ? "mirror" : "primary"}`;
    return `pick:${pickKey(pick)}:${item.protection || pick.protection || ""}:${rule.action || ""}:${rule.protectStart || ""}:${rule.protectEnd || ""}`;
  }
  return `${item.type}:${JSON.stringify(item)}`;
}

function packageKey(items = []) {
  return items.map(itemKey).sort().join("||");
}

function itemFamilyKey(item = {}) {
  if (item.type === "player") return `player:${playerKey(item.player)}`;
  if (item.type === "pick") {
    const pick = item.pick || {};
    const rule = item.tradeRule || pick.tradeRule || {};
    if (rule.swapId) return `swap:${rule.swapId}`;
    return `pick:${pick.id || pick.pickId || `${pick.assetType || pick.type || "pick"}:${pick.year || ""}:${pick.round || ""}:${pick.originalTeam || pick.originalTeamName || ""}:${pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || ""}`}`;
  }
  return itemKey(item);
}

function uniqueByFamilyKey(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = itemFamilyKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickProtectionLabel(pick) {
  const label = String(getTradePickBaseProtectionLabel(pick) || pick?.protection || pick?.protections || pick?.displayProtection || "").trim();
  if (!label || label.toLowerCase() === "none" || label.toLowerCase() === "null") return DEFAULT_PICK_PROTECTION;
  return label;
}

function formatPick(pick) {
  const round = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "Own";
  const pickNumber = Number(pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || pick?.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${pick?.year || "Future"} ${round}${pickText} - ${original}`;
}

function playerValue(player, leagueData) {
  const overall = Number(player?.overall || 0);
  const potential = Number(player?.potential || overall || 0);
  const age = Number(player?.age || 27);
  const salaryM = getPlayerSalary(player, leagueData) / 1_000_000;
  const primeBonus = age <= 25 ? 10 : age <= 28 ? 6 : age <= 31 ? 2 : -3;
  const contractPenalty = Math.max(0, salaryM - 18) * 0.45;
  const starBonus = overall >= 90 ? 18 : overall >= 85 ? 8 : overall >= 80 ? 3 : 0;

  return Math.max(1, overall * 0.72 + potential * 0.42 + primeBonus + starBonus - contractPenalty);
}

function pickValue(pick, protection = DEFAULT_PICK_PROTECTION, leagueData = null) {
  const round = Number(pick?.round || 1);
  const year = Number(pick?.year || 2030);
  const now = getSeasonYearFromLeague(leagueData || {});
  const pickNumber = Number(
    pick?.pickNumber ||
      pick?.overallPick ||
      pick?.resolvedPickNumber ||
      pick?.draftPickNumber ||
      pick?.projectedRank ||
      0
  );
  const exactPick = isResolvedDraftPickAsset(pick) || pickNumber > 0;
  const projectedRank = pickNumber || Number(pick?.projectedRank || pick?.recordRank || pick?.expectedRank || pick?.slot || 18);
  const yearsOut = exactPick && Number(year) === Number(now) ? 0 : Math.max(0, year - now);
  const futurePenalty = yearsOut * (round === 1 ? 1.75 : 0.7);
  const protectionText = String(exactPick ? DEFAULT_PICK_PROTECTION : protection || DEFAULT_PICK_PROTECTION).toLowerCase();

  let base = round === 1
    ? Math.max(6, 38 - projectedRank * 0.85)
    : Math.max(1, 7 - projectedRank * 0.08);

  if (exactPick && round === 1) {
    if (projectedRank <= 1) base += 10;
    else if (projectedRank <= 3) base += 6;
    else if (projectedRank <= 14) base += 2.5;
  } else if (exactPick) {
    base += 1;
  }

  let protectionPenalty = 0;
  if (protectionText.includes("lottery") || protectionText.includes("1-14")) protectionPenalty = 11;
  else if (protectionText.includes("top 20")) protectionPenalty = 15;
  else if (protectionText.includes("top 10")) protectionPenalty = 8;
  else if (protectionText.includes("top 8")) protectionPenalty = 6;
  else if (protectionText.includes("top 5")) protectionPenalty = 4;
  else if (protectionText.includes("top 3")) protectionPenalty = 3;
  else if (protectionText.includes("protected")) protectionPenalty = round === 1 ? 7 : 1.5;

  return Math.max(2, base - futurePenalty - protectionPenalty);
}

function assetValue(asset, leagueData) {
  if (asset.type === "player") return playerValue(asset.player, leagueData);
  return pickValue(asset.pick, asset.protection, leagueData);
}

function packageValue(items, leagueData) {
  return (items || []).reduce((sum, item) => sum + assetValue(item, leagueData), 0);
}

function pickSortYear(item = {}) {
  return Number(item?.pick?.year || 9999);
}

function pickSortRound(item = {}) {
  return Number(item?.pick?.round || 1);
}

function pickSortSlot(item = {}) {
  const pick = item?.pick || {};
  return Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.draftPickNumber || pick.projectedRank || 99);
}

export function sortTradeFinderOfferItems(items = [], leagueData = null) {
  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => {
    const aIsPlayer = a?.type === "player";
    const bIsPlayer = b?.type === "player";
    const aIsSwap = a?.type === "pick" && isSwapDraftPickAsset(a.pick || {});
    const bIsSwap = b?.type === "pick" && isSwapDraftPickAsset(b.pick || {});
    const aRound = pickSortRound(a);
    const bRound = pickSortRound(b);
    const groupOf = (item, isPlayer, isSwap, round) => {
      if (isPlayer) return 0;
      if (isSwap) return 3;
      return Number(round || 1) === 1 ? 1 : 2;
    };
    const groupA = groupOf(a, aIsPlayer, aIsSwap, aRound);
    const groupB = groupOf(b, bIsPlayer, bIsSwap, bRound);
    if (groupA !== groupB) return groupA - groupB;

    if (aIsPlayer && bIsPlayer) {
      const aOvr = Number(a.player?.overall || 0);
      const bOvr = Number(b.player?.overall || 0);
      if (aOvr !== bOvr) return bOvr - aOvr;
      const aVal = playerValue(a.player, leagueData);
      const bVal = playerValue(b.player, leagueData);
      if (aVal !== bVal) return bVal - aVal;
      return playerNameOf(a.player).localeCompare(playerNameOf(b.player));
    }

    if (!aIsPlayer && !bIsPlayer) {
      const yearDiff = pickSortYear(a) - pickSortYear(b);
      if (yearDiff) return yearDiff;
      const slotDiff = pickSortSlot(a) - pickSortSlot(b);
      if (slotDiff) return slotDiff;
      return String(a.label || "").localeCompare(String(b.label || ""));
    }

    return 0;
  });
}

function isStandardRosterPlayer(player = {}) {
  const status = String(player.rosterStatus || player.contractType || "").toLowerCase();
  return !(
    player.isTwoWay ||
    player.isStash ||
    status.includes("two_way") ||
    status.includes("two-way") ||
    status.includes("stash") ||
    status.includes("stashed")
  );
}

function isAlreadyExistingSwapPick(pick = {}) {
  if (!isSwapDraftPickAsset(pick)) return false;
  const generated = pick?.realLifeDetails?.tradeGenerated || pick?.logicType === "trade_machine_swap" || pick?.source === "Trade Machine";
  return !generated || Boolean(pick.id || pick.pickId);
}

function buildFullPickTradeRule(pick) {
  // Existing swap rights are already draft-pick assets in leagueData.draftPicks.
  // Trade Finder may transfer those existing assets, but it must not create a new swap.
  return {
    action: "full",
    ownedRange: getTradeablePickOwnedRange(pick),
    source: isSwapDraftPickAsset(pick) ? "trade_finder_existing_swap" : "trade_finder_offer_engine",
  };
}

function buildPickItem(pick, protection, tradeRule, valueAdjust = 0) {
  const cleanProtection = protection || pickProtectionLabel(pick);
  return {
    type: "pick",
    pick: {
      ...pick,
      protection: cleanProtection,
      protections: cleanProtection,
      displayProtection: cleanProtection,
      tradeRule,
    },
    protection: cleanProtection,
    tradeRule,
    label: `${cleanProtection} ${formatPick(pick)}`,
    valueAdjust,
    salary: 0,
  };
}

function buildProtectedPickVariant(pick, protectEnd) {
  const owned = getTradeablePickOwnedRange(pick);
  const validation = validateCustomPickProtection(pick, owned.start, protectEnd);
  if (!validation.ok) return null;

  const tradeRule = {
    action: "protected",
    protectStart: validation.retainedRange.start,
    protectEnd: validation.retainedRange.end,
    retainedRange: validation.retainedRange,
    conveyedRange: validation.conveyedRange,
    ownedRange: validation.ownedRange,
    baseProtectionLabel: validation.baseProtectionLabel,
    source: "trade_finder_offer_engine",
  };

  return buildPickItem(pick, validation.baseProtectionLabel, tradeRule, -0.8);
}

function getProtectionEndsForPick(pick = {}) {
  const owned = getTradeablePickOwnedRange(pick);
  const candidates = Number(pick.round || 1) === 1 ? [14, 10, 5] : [50, 45];
  return candidates
    .map((value) => Math.max(Number(owned.start || 1), Math.min(Number(owned.end || 30) - 1, Number(value))))
    .filter((value, index, arr) => Number.isFinite(value) && value >= Number(owned.start || 1) && value < Number(owned.end || 30) && arr.indexOf(value) === index);
}

function buildPickCandidates(team, leagueData) {
  const teamName = getTeamName(team);
  const rows = collectTradeablePicksForTeam(leagueData, teamName);
  const out = [];

  for (const pick of rows) {
    const baseProtection = pickProtectionLabel(pick);
    if (isSwapDraftPickAsset(pick) && !isAlreadyExistingSwapPick(pick)) continue;

    out.push(buildPickItem(pick, baseProtection, buildFullPickTradeRule(pick)));

    const canCpuAddProtection =
      !isSwapDraftPickAsset(pick) &&
      !isResolvedDraftPickAsset(pick) &&
      canAddCustomProtectionToPick(pick) &&
      String(baseProtection || "").toLowerCase() === "unprotected";

    if (canCpuAddProtection) {
      for (const protectEnd of getProtectionEndsForPick(pick)) {
        const variant = buildProtectedPickVariant(pick, protectEnd);
        if (variant) out.push(variant);
      }
    }
  }

  const seen = new Set();
  return out
    .map((item) => ({
      ...item,
      value: pickValue(item.pick, item.protection, leagueData) + Number(item.valueAdjust || 0),
      balanceAsset: true,
    }))
    .sort((a, b) => b.value - a.value)
    .filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildPlayerCandidates(team, leagueData) {
  return getTeamPlayers(team)
    .filter(isStandardRosterPlayer)
    .map((player) => {
      const salary = getPlayerSalary(player, leagueData);
      const value = playerValue(player, leagueData);
      return {
        type: "player",
        player,
        label: playerNameOf(player),
        salary,
        value,
        salaryValueRatio: salary > 0 ? value / Math.max(1, salary / 1_000_000) : value + 999,
      };
    })
    .sort((a, b) => b.value - a.value);
}

function uniqueByItemKey(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCandidateAssets(team, leagueData) {
  const players = buildPlayerCandidates(team, leagueData);
  const picks = buildPickCandidates(team, leagueData);

  const playerPool = uniqueByItemKey([
    ...players.slice(0, MAX_PLAYER_CANDIDATES),
    ...players.slice().sort((a, b) => b.salary - a.salary).slice(0, 6),
    ...players.slice().sort((a, b) => a.salaryValueRatio - b.salaryValueRatio).slice(0, 4),
    ...players.slice().sort((a, b) => a.value - b.value).slice(0, 4),
  ]).slice(0, MAX_PLAYER_CANDIDATES + 4);

  const pickPool = uniqueByItemKey([
    ...picks.slice(0, MAX_PICK_CANDIDATES),
    ...picks.slice().sort((a, b) => a.value - b.value).slice(0, 6),
  ]).slice(0, MAX_PICK_CANDIDATES + 3);

  return {
    players,
    picks,
    candidates: uniqueByItemKey([...playerPool, ...pickPool]),
    playerPool,
    balancePlayers: playerPool.slice().sort((a, b) => a.value - b.value).slice(0, 10),
    balancePicks: pickPool,
  };
}

function clonePackage(items = []) {
  return items.slice();
}

function addPackage(packageMap, items = []) {
  const clean = uniqueByFamilyKey(items).slice(0, MAX_SIDE_ITEMS);
  if (!clean.length) return;
  packageMap.set(packageKey(clean), clean);
}

function financialOk({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems }) {
  const selectedFinancial = evaluateTradeFinancialLegality({
    team: selectedTeam,
    leagueData,
    outgoingSalary: sideSalary(selectedItems, leagueData),
    incomingSalary: sideSalary(cpuItems, leagueData),
  });
  if (!selectedFinancial.ok) return false;

  const cpuFinancial = evaluateTradeFinancialLegality({
    team: cpuTeam,
    leagueData,
    outgoingSalary: sideSalary(cpuItems, leagueData),
    incomingSalary: sideSalary(selectedItems, leagueData),
  });

  return Boolean(cpuFinancial.ok);
}

function rankPackageForSearch(items = [], targetValue = 0, leagueData = null) {
  const total = packageValue(items, leagueData);
  const playerCount = items.filter((item) => item.type === "player").length;
  const pickCount = items.length - playerCount;
  const gap = Math.abs(total - targetValue);
  const underPenalty = total < targetValue * 0.35 ? 18 : 0;
  const emptyPenalty = items.length ? 0 : 999;
  const highValueTarget = Number(targetValue || 0) >= 70;
  const pickPenalty = highValueTarget ? Math.max(0.2, 1.15 - pickCount * 0.12) : 2.2;
  return emptyPenalty + gap + underPenalty + pickCount * pickPenalty - playerCount * 1.4 + items.length * 0.35;
}

function buildSalaryFocusedPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, seed, players }) {
  const pkg = seed ? [seed] : [];
  const used = new Set(pkg.map(itemFamilyKey));
  const ordered = players
    .filter((item) => !used.has(itemFamilyKey(item)))
    .sort((a, b) => {
      const aScore = (a.salary || 0) / 1_000_000 - (a.value || 0) * 0.12;
      const bScore = (b.salary || 0) / 1_000_000 - (b.value || 0) * 0.12;
      return bScore - aScore;
    });

  if (financialOk({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: pkg })) return pkg;

  for (const asset of ordered) {
    if (pkg.length >= MAX_SIDE_ITEMS) break;
    pkg.push(asset);
    used.add(itemFamilyKey(asset));
    if (financialOk({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: pkg })) break;
  }

  return pkg;
}

function buildPlayerLedPackage({ seed, players, targetValue, leagueData }) {
  const pkg = seed ? [seed] : [];
  const used = new Set(pkg.map(itemFamilyKey));
  let total = packageValue(pkg, leagueData);

  while (pkg.length < MAX_SIDE_ITEMS) {
    const gap = targetValue - total;
    if (pkg.length > 0 && gap <= Math.max(4, targetValue * 0.08)) break;

    let best = null;
    let bestScore = Infinity;

    for (const asset of players) {
      const key = itemFamilyKey(asset);
      if (used.has(key)) continue;
      const nextTotal = total + assetValue(asset, leagueData);
      const remainingGap = Math.abs(targetValue - nextTotal);
      const overshootPenalty = nextTotal > targetValue ? (nextTotal - targetValue) * 0.35 : 0;
      const salaryHelp = Math.min(8, Math.max(0, (asset.salary || 0) / 1_000_000) * 0.08);
      const score = remainingGap + overshootPenalty - salaryHelp + pkg.length * 0.25;
      if (score < bestScore) {
        best = asset;
        bestScore = score;
      }
    }

    if (!best) break;
    const currentGap = Math.abs(targetValue - total);
    const nextGap = Math.abs(targetValue - (total + assetValue(best, leagueData)));
    if (pkg.length > 0 && nextGap > currentGap * 1.2 && total >= targetValue * 0.42) break;
    pkg.push(best);
    used.add(itemFamilyKey(best));
    total += assetValue(best, leagueData);
  }

  return pkg;
}

function buildValueGreedyPackage({ seed, candidates, targetValue, leagueData, preferPlayers = false }) {
  const pkg = seed ? [seed] : [];
  const used = new Set(pkg.map(itemFamilyKey));
  let total = packageValue(pkg, leagueData);

  while (pkg.length < MAX_SIDE_ITEMS) {
    let best = null;
    let bestScore = Infinity;

    for (const asset of candidates) {
      const key = itemFamilyKey(asset);
      if (used.has(key)) continue;
      const nextTotal = total + assetValue(asset, leagueData);
      const gapScore = Math.abs(targetValue - nextTotal);
      const overpayPenalty = nextTotal > targetValue ? (nextTotal - targetValue) * 0.18 : 0;
      const playerBonus = preferPlayers && asset.type === "player" ? -2.2 : 0;
      const pickPenalty = preferPlayers && asset.type === "pick" ? 2.6 : 0;
      const score = gapScore + overpayPenalty + pickPenalty + playerBonus + pkg.length * 0.12;
      if (score < bestScore) {
        best = asset;
        bestScore = score;
      }
    }

    if (!best) break;
    const currentGap = Math.abs(targetValue - total);
    const nextGap = Math.abs(targetValue - (total + assetValue(best, leagueData)));
    if (pkg.length > 0 && nextGap > currentGap * 1.12) break;
    pkg.push(best);
    used.add(itemFamilyKey(best));
    total += assetValue(best, leagueData);
    if (total >= targetValue * 0.94) break;
  }

  return pkg;
}

function buildPickBridgePackage({ playerPackage = [], picks = [], targetValue, leagueData }) {
  const pkg = playerPackage.slice();
  const used = new Set(pkg.map(itemFamilyKey));
  let total = packageValue(pkg, leagueData);
  const highValueTarget = Number(targetValue || 0) >= 75;
  const orderedPicks = picks.slice().sort((a, b) =>
    highValueTarget ? assetValue(b, leagueData) - assetValue(a, leagueData) : assetValue(a, leagueData) - assetValue(b, leagueData)
  );

  for (const pick of orderedPicks) {
    if (pkg.length >= MAX_SIDE_ITEMS) break;
    if (used.has(itemFamilyKey(pick))) continue;
    const currentGap = Math.abs(targetValue - total);
    const nextTotal = total + assetValue(pick, leagueData);
    const nextGap = Math.abs(targetValue - nextTotal);
    const improvesEnough = nextGap <= currentGap * (highValueTarget ? 1.08 : 0.98);
    if (!improvesEnough && total >= targetValue * 0.5) continue;
    pkg.push(pick);
    used.add(itemFamilyKey(pick));
    total = nextTotal;
    if (total >= targetValue * (highValueTarget ? 0.76 : 0.88)) break;
  }

  return pkg;
}

function buildBasePackages({ leagueData, selectedTeam, cpuTeam, selectedItems, players, picks, candidates, playerPool, profile = null }) {
  const packageMap = new Map();
  const selectedValue = packageValue(selectedItems, leagueData);
  const playerSeeds = uniqueByItemKey([
    ...players.slice(0, 9),
    ...players.slice().sort((a, b) => b.salary - a.salary).slice(0, 5),
    ...players.slice().sort((a, b) => a.value - b.value).slice(0, 4),
  ]).slice(0, 12);

  for (const asset of playerSeeds.slice(0, 8)) addPackage(packageMap, [asset]);

  for (const seed of playerSeeds) {
    const lowPlayer = buildPlayerLedPackage({ seed, players: playerPool || players, targetValue: selectedValue * 0.52, leagueData });
    const midPlayer = buildPlayerLedPackage({ seed, players: playerPool || players, targetValue: selectedValue * 0.74, leagueData });
    const fullPlayer = buildPlayerLedPackage({ seed, players: playerPool || players, targetValue: selectedValue * 0.94, leagueData });
    addPackage(packageMap, lowPlayer);
    addPackage(packageMap, midPlayer);
    addPackage(packageMap, fullPlayer);
    addPackage(packageMap, buildPickBridgePackage({ playerPackage: midPlayer, picks, targetValue: selectedValue * 0.9, leagueData }));
    if (profile?.preferPicksForHighValue || selectedValue >= 90) {
      addPackage(packageMap, buildPickBridgePackage({ playerPackage: lowPlayer, picks, targetValue: selectedValue * 0.82, leagueData }));
      addPackage(packageMap, buildPickBridgePackage({ playerPackage: fullPlayer, picks, targetValue: selectedValue * 0.98, leagueData }));
    }
  }

  for (const seed of playerSeeds.slice(0, 6)) {
    addPackage(packageMap, buildSalaryFocusedPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, seed, players }));
  }
  addPackage(packageMap, buildSalaryFocusedPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, seed: null, players }));

  // Pick-led offers are fallback candidates, not the default identity of the offer.
  // They help when the user package is small, or a team cannot match with useful players.
  for (const seed of picks.slice(0, 7)) {
    addPackage(packageMap, [seed]);
    addPackage(packageMap, buildValueGreedyPackage({ seed, candidates: picks.slice(0, 10), targetValue: selectedValue * 0.72, leagueData }));
  }

  const packages = [...packageMap.values()]
    .filter((items) => items.length && items.length <= MAX_SIDE_ITEMS)
    .sort((a, b) => rankPackageForSearch(a, selectedValue * 0.72, leagueData) - rankPackageForSearch(b, selectedValue * 0.72, leagueData));

  return packages.slice(0, MAX_BASE_PACKAGES_PER_TEAM);
}

function hasAcceptedEvaluation(evaluation) {
  return Boolean(
    evaluation?.accepted ||
      String(evaluation?.decision || "").toLowerCase() === "accept" ||
      String(evaluation?.decision || "").toLowerCase() === "accepted"
  );
}

function getComfortMargin(evaluation = {}) {
  const score = Number(evaluation.score || 0);
  const threshold = Number(evaluation?.teamImpact?.threshold ?? 0);
  return score - threshold;
}

function getTradeFinderEvaluationPath(profile = null) {
  const phase = String(profile?.searchPhase || "single").toLowerCase();
  const fastScan = shouldUseTradeFinderFastScanImpactForProfile(profile);
  return `${fastScan ? "fast_scan" : "exact"}:${phase}`;
}

function tradeFinderEvaluationCacheKey(items = [], profile = null) {
  return `${getTradeFinderEvaluationPath(profile)}::${packageKey(items)}`;
}

function isApproximateTradeFinderOffer(offer = {}) {
  return Boolean(
    offer?.approximateEvaluation ||
      offer?.finderEvaluationMode === "fast_scan" ||
      String(offer?.evaluation?.teamImpact?.ratingMode || "").toLowerCase() === "fast-scan" ||
      String(offer?.evaluation?.teamImpact?.after?.ratingMode || "").toLowerCase() === "fast-scan" ||
      String(offer?.evaluation?.teamImpact?.before?.ratingMode || "").toLowerCase() === "fast-scan"
  );
}

function makeExactRefineEvalState({ profile = {}, sharedCache = null, sharedFinancialCache = null, teamStartedAt = 0, searchStartedAt = 0 } = {}) {
  return {
    cache: sharedCache || new Map(),
    financialCache: sharedFinancialCache || new Map(),
    count: 0,
    profile: {
      ...(profile || {}),
      searchPhase: "refine",
      name: `${profile?.name || "trade_finder"}_exact_current_offer_check`,
      maxEvaluationsPerTeam: 1,
      maxBasePackagesPerTeam: 1,
      maxBalanceRounds: 0,
      forcePickRecovery: false,
      maxPickRecoveryCandidates: 0,
    },
    teamStartedAt,
    searchStartedAt,
    metrics: {
      candidateMs: 0,
      basePackageMs: 0,
      impactMs: 0,
      finalValidationMs: 0,
      financialMs: 0,
      yieldMs: 0,
      impactCacheHits: 0,
      preRejected: 0,
      cacheHits: 0,
      financialCacheHits: 0,
      cpuRejected: 0,
      comfortRejected: 0,
      finalRejected: 0,
      accepted: 0,
    },
  };
}

function preValidatePackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems, evalState = null }) {
  if (!Array.isArray(cpuItems) || !cpuItems.length || cpuItems.length > MAX_SIDE_ITEMS) return false;
  if (!Array.isArray(selectedItems) || !selectedItems.length || selectedItems.length > MAX_SIDE_ITEMS) return false;

  const financialKey = packageKey(cpuItems);
  if (evalState?.financialCache?.has(financialKey)) {
    if (evalState?.metrics) evalState.metrics.financialCacheHits = Number(evalState.metrics.financialCacheHits || 0) + 1;
    return evalState.financialCache.get(financialKey);
  }

  const startedAt = tfDebugNow();
  const ok = financialOk({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems });
  if (evalState?.metrics) evalState.metrics.financialMs = Number(evalState.metrics.financialMs || 0) + (tfDebugNow() - startedAt);
  if (evalState?.financialCache) evalState.financialCache.set(financialKey, ok);
  return ok;
}

function evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems, evalState }) {
  const __tfEvalStart = tfDebugNow();
  const __tfTeamName = getTeamName(cpuTeam);
  const __tfItemLabel = tfItemsLabel(cpuItems);

  if (!preValidatePackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems, evalState })) {
    if (evalState?.metrics) evalState.metrics.preRejected = Number(evalState.metrics.preRejected || 0) + 1;
    return null;
  }

  const key = tradeFinderEvaluationCacheKey(cpuItems, evalState?.profile);
  if (evalState?.cache?.has(key)) {
    if (evalState?.metrics) evalState.metrics.cacheHits = Number(evalState.metrics.cacheHits || 0) + 1;
    return evalState.cache.get(key);
  }
  if (evalState) evalState.count = Number(evalState.count || 0) + 1;

  const finderUsedFastScan = shouldUseTradeFinderFastScanImpactForProfile(evalState?.profile);
  const finderEvaluationPath = getTradeFinderEvaluationPath(evalState?.profile);
  const __tfImpactStart = tfDebugNow();
  const evaluation = evaluateTradeTeamImpact({
    leagueData,
    userTeam: selectedTeam,
    cpuTeam,
    userTeamName: getTeamName(selectedTeam),
    cpuTeamName: getTeamName(cpuTeam),
    userItems: selectedItems,
    cpuItems,
    evaluationMode: "standard",
    cpuTradeRole: "trade_finder",
    cpuTradeContext: {
      source: "trade_finder_offer_engine",
      searchPhase: evalState?.profile?.searchPhase || "single",
      tradeFinderFastScan: finderUsedFastScan,
    },
  });
  const __tfImpactMs = tfDebugNow() - __tfImpactStart;
  if (evalState?.metrics) {
    evalState.metrics.impactMs = Number(evalState.metrics.impactMs || 0) + __tfImpactMs;
    if (evaluation?.__tfImpactCacheHit) evalState.metrics.impactCacheHits = Number(evalState.metrics.impactCacheHits || 0) + 1;
  }
  if (isTradeFinderDebugEnabled() && __tfImpactMs >= TRADE_FINDER_SLOW_EVAL_MS) {
    tfDebugLog("slow evaluateTradeTeamImpact", {
      team: __tfTeamName,
      impactMs: tfRoundMs(__tfImpactMs),
      totalEvalMs: tfRoundMs(tfDebugNow() - __tfEvalStart),
      cpuItems: __tfItemLabel,
      score: Number(evaluation?.score || 0),
      threshold: Number(evaluation?.teamImpact?.threshold || 0),
      accepted: hasAcceptedEvaluation(evaluation),
    });
  }

  if (!hasAcceptedEvaluation(evaluation)) {
    if (evalState?.metrics) evalState.metrics.cpuRejected = Number(evalState.metrics.cpuRejected || 0) + 1;
    if (evalState?.cache) evalState.cache.set(key, null);
    return null;
  }

  const comfortMargin = getComfortMargin(evaluation);
  if (comfortMargin < COMFORT_FLOOR) {
    if (evalState?.metrics) evalState.metrics.comfortRejected = Number(evalState.metrics.comfortRejected || 0) + 1;
    if (evalState?.cache) evalState.cache.set(key, null);
    return null;
  }

  const __tfFinalValidationStart = tfDebugNow();
  const finalValidation = validateTradeForExecution({
    leagueData,
    userTeam: selectedTeam,
    cpuTeam,
    userItems: selectedItems,
    cpuItems,
    evaluation,
  });
  const __tfFinalValidationMs = tfDebugNow() - __tfFinalValidationStart;
  if (evalState?.metrics) evalState.metrics.finalValidationMs = Number(evalState.metrics.finalValidationMs || 0) + __tfFinalValidationMs;
  if (!finalValidation.ok) {
    if (evalState?.metrics) evalState.metrics.finalRejected = Number(evalState.metrics.finalRejected || 0) + 1;
    if (evalState?.cache) evalState.cache.set(key, null);
    return null;
  }

  const sortedItems = sortTradeFinderOfferItems(cpuItems, leagueData);
  const offerValue = packageValue(sortedItems, leagueData);
  const targetValue = packageValue(selectedItems, leagueData);

  const result = {
    team: cpuTeam,
    offer: sortedItems,
    accepted: true,
    decision: "accept",
    evaluation,
    validation: finalValidation,
    comfortMargin,
    offerValue,
    targetValue,
    gap: offerValue - targetValue,
    quality: comfortMargin <= TARGET_COMFORT_MARGIN + 0.22 ? "Comfort Offer" : "CPU-Lean Offer",
    finderEvaluationMode: finderUsedFastScan ? "fast_scan" : "exact",
    finderEvaluationPath,
    finderSearchPhase: evalState?.profile?.searchPhase || "single",
    approximateEvaluation: Boolean(finderUsedFastScan),
  };

  if (evalState?.metrics) evalState.metrics.accepted = Number(evalState.metrics.accepted || 0) + 1;
  if (evalState?.cache) evalState.cache.set(key, result);
  return result;
}

function scoreOffer(result, profile = null) {
  if (!result) return Infinity;
  const margin = Number(result.comfortMargin || 0);
  const closeness = Math.abs(margin - TARGET_COMFORT_MARGIN);
  const offer = Array.isArray(result.offer) ? result.offer : [];
  const assetCount = offer.length || 99;
  const playerCount = offer.filter((item) => item.type === "player").length;
  const pickCount = offer.filter((item) => item.type === "pick").length;
  const gap = Number(result.gap || 0);
  const valueGap = Math.abs(gap);
  const underpay = Math.max(0, -gap);
  const noPlayerPenalty = playerCount ? 0 : 8;
  const wantsFairHighValue = Boolean(profile?.preferPicksForHighValue || profile?.forcePickRecovery);
  const pickScore = wantsFairHighValue && underpay > 8 ? pickCount * -3.2 : pickCount * 0.45;
  const underpayPenalty = wantsFairHighValue ? underpay * 0.34 : valueGap * 0.008;
  const assetPenalty = wantsFairHighValue ? assetCount * 0.18 : assetCount * 0.28;
  const overpayPenalty = Math.max(0, gap) * (wantsFairHighValue ? 0.035 : 0.008);

  return closeness * 100 + assetPenalty + pickScore - playerCount * 0.28 + noPlayerPenalty + underpayPenalty + overpayPenalty;
}

async function tryBalanceWithAdditionalAssets({
  leagueData,
  selectedTeam,
  cpuTeam,
  selectedItems,
  startResult,
  additions,
  evalState,
  signal = null,
}) {
  if (!startResult || !Array.isArray(additions) || !additions.length) return startResult;

  let best = startResult;
  let bestScore = scoreOffer(best, evalState?.profile);
  let currentItems = clonePackage(startResult.offer);
  const selectedValue = packageValue(selectedItems, leagueData);

  const maxBalanceRounds = Number(evalState?.profile?.maxBalanceRounds ?? MAX_BALANCE_ROUNDS);
  if (maxBalanceRounds <= 0) return startResult;

  for (let round = 0; round < maxBalanceRounds; round += 1) {
    if (isTradeFinderSearchCancelled(signal)) break;
    if (currentItems.length >= MAX_SIDE_ITEMS) break;
    if (Number(evalState?.count || 0) >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState) || hasSearchTimeBudgetExpired(evalState)) break;

    const used = new Set(currentItems.map(itemFamilyKey));
    const currentValue = packageValue(currentItems, leagueData);
    const currentGap = Math.abs(selectedValue - currentValue);
    const wantsPicks = Boolean(evalState?.profile?.preferPicksForHighValue || evalState?.profile?.forcePickRecovery);
    const assetCandidates = additions
      .filter((asset) => !used.has(itemFamilyKey(asset)))
      .map((asset) => {
        const nextValue = currentValue + assetValue(asset, leagueData);
        const nextGap = Math.abs(selectedValue - nextValue);
        const playerBonus = asset.type === "player" ? -1.5 : 0;
        const pickPenalty = asset.type === "pick" ? (wantsPicks && currentValue < selectedValue ? -1.8 : 0.65) : 0;
        return { asset, roughScore: nextGap - currentGap + playerBonus + pickPenalty };
      })
      .sort((a, b) => a.roughScore - b.roughScore)
      .slice(0, wantsPicks ? 8 : 6);

    let bestAdditionResult = null;
    let bestAdditionScore = bestScore;

    for (const row of assetCandidates) {
      if (isTradeFinderSearchCancelled(signal)) break;
      if (Number(evalState?.count || 0) >= getEvalLimit(evalState)) break;
      if (hasTeamTimeBudgetExpired(evalState) || hasSearchTimeBudgetExpired(evalState)) break;
      const nextItems = uniqueByFamilyKey([...currentItems, row.asset]);
      const evaluated = evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: nextItems, evalState });
      if (evalState?.count && evalState.count % TRADE_FINDER_YIELD_EVERY_EVALUATIONS === 0) {
        await tfYieldToBrowser(evalState.metrics);
      }
      if (!evaluated) continue;
      const nextScore = scoreOffer(evaluated, evalState?.profile);

      if (nextScore < bestAdditionScore || Number(evaluated.gap || 0) > Number(best?.gap || 0) + 6) {
        bestAdditionResult = evaluated;
        bestAdditionScore = nextScore;
      }
    }

    if (!bestAdditionResult) break;
    currentItems = bestAdditionResult.offer;
    best = bestAdditionResult;
    bestScore = bestAdditionScore;

    if (Math.abs(Number(best.comfortMargin || 0) - TARGET_COMFORT_MARGIN) <= 0.07) break;
  }

  return best;
}

function offerPickCount(result = null) {
  return Array.isArray(result?.offer) ? result.offer.filter((item) => item?.type === "pick").length : 0;
}

function shouldRunPickRecovery(result, profile = null) {
  if (!result || !profile?.forcePickRecovery) return false;
  const gap = Number(result.gap || 0);
  const minGap = Number(profile.minOfferGapForFairness ?? -20);
  const pickCount = offerPickCount(result);
  const cpuLean = String(result.quality || "").toLowerCase().includes("cpu-lean");
  return gap < minGap || (pickCount === 0 && gap < -8 && cpuLean);
}

async function tryPickRecovery({
  leagueData,
  selectedTeam,
  cpuTeam,
  selectedItems,
  startResult,
  picks = [],
  evalState,
  signal = null,
}) {
  if (!startResult || !Array.isArray(picks) || !picks.length || !evalState?.profile?.forcePickRecovery) return startResult;
  if (!shouldRunPickRecovery(startResult, evalState.profile)) return startResult;

  let best = startResult;
  let bestScore = scoreOffer(best, evalState.profile);
  const maxCandidates = Number(evalState.profile.maxPickRecoveryCandidates || 0);
  if (maxCandidates <= 0) return startResult;

  const orderedPicks = picks
    .slice()
    .sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData))
    .slice(0, maxCandidates);

  for (const pick of orderedPicks) {
    if (isTradeFinderSearchCancelled(signal)) break;
    if (Number(evalState?.count || 0) >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState) || hasSearchTimeBudgetExpired(evalState)) break;
    if (best.offer.length >= MAX_SIDE_ITEMS) break;
    if (best.offer.some((item) => itemFamilyKey(item) === itemFamilyKey(pick))) continue;

    const nextItems = uniqueByFamilyKey([...best.offer, pick]);
    const evaluated = evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: nextItems, evalState });
    if (evalState?.count && evalState.count % TRADE_FINDER_YIELD_EVERY_EVALUATIONS === 0) {
      await tfYieldToBrowser(evalState.metrics);
    }
    if (!evaluated) continue;

    const nextScore = scoreOffer(evaluated, evalState.profile);
    const materiallyFairer = Number(evaluated.gap || 0) > Number(best.gap || 0) + 5;
    if (nextScore < bestScore || materiallyFairer) {
      best = evaluated;
      bestScore = nextScore;
    }

    if (!shouldRunPickRecovery(best, evalState.profile)) break;
  }

  return best;
}

function shouldUseTwoPassTradeFinderSearch(profile = {}, selectedItems = [], leagueData = null) {
  if (String(profile?.mode || "") !== "accurate") return false;
  const counts = countTradeFinderItemTypes(selectedItems);
  const selectedValue = packageValue(selectedItems, leagueData);
  return Boolean(
    profile?.forcePickRecovery ||
      selectedValue >= 85 ||
      counts.assetCount >= 2 ||
      counts.playerCount >= 2
  );
}

function applyTradeFinderPhaseProfile(baseProfile = {}, searchPhase = "single") {
  const phase = String(searchPhase || "single").toLowerCase();
  if (phase === "scan") {
    return {
      ...baseProfile,
      name: `${baseProfile.name || "trade_finder"}_scan`,
      searchPhase: "scan",
      reason: `${baseProfile.reason || "accurate search"} • two-pass quick scan`,
      maxEvaluationsPerTeam: 2,
      maxBasePackagesPerTeam: Math.min(Number(baseProfile.maxBasePackagesPerTeam || MAX_BASE_PACKAGES_PER_TEAM), 12),
      maxBalanceRounds: 0,
      maxAcceptedBaseSeeds: 1,
      baseEvalMinBeforeEarlyStop: 0,
      goodEnoughScore: 999,
      stopAfterFirstAccepted: true,
      firstAcceptedImmediate: true,
      forcePickRecovery: false,
      maxPickRecoveryCandidates: 0,
      perTeamBudgetMs: Math.min(Number(baseProfile.perTeamBudgetMs || 3200), 3200),
      missRisk: "scan_then_refine",
    };
  }

  if (phase === "rescue") {
    return {
      ...baseProfile,
      name: `${baseProfile.name || "trade_finder"}_rescue`,
      searchPhase: "rescue",
      reason: `${baseProfile.reason || "accurate search"} • two-pass missed-team rescue`,
      // Rescue is only for teams that found no offer in the shallow scan.
      // Let it look deeper through salary-matching packages, but keep it much
      // cheaper than the old full accurate search.
      maxEvaluationsPerTeam: 5,
      maxBasePackagesPerTeam: Math.min(Number(baseProfile.maxBasePackagesPerTeam || MAX_BASE_PACKAGES_PER_TEAM), 26),
      maxBalanceRounds: 0,
      maxAcceptedBaseSeeds: 1,
      baseEvalMinBeforeEarlyStop: 1,
      goodEnoughScore: 999,
      stopAfterFirstAccepted: true,
      firstAcceptedImmediate: false,
      forcePickRecovery: false,
      maxPickRecoveryCandidates: 0,
      perTeamBudgetMs: Math.min(Number(baseProfile.perTeamBudgetMs || 5600), 6200),
      missRisk: "always_rescue_missed_teams",
    };
  }

  if (phase === "refine") {
    const refineSettings = getTradeFinderRefineSettings();
    return {
      ...baseProfile,
      name: `${baseProfile.name || "trade_finder"}_${refineSettings.mode === "ultra_fast" ? "refine_ultra_fast" : "refine_fast_quality"}`,
      searchPhase: "refine",
      reason: `${baseProfile.reason || "accurate search"} • two-pass top-offer refinement, ${refineSettings.policy}`,
      // Scan + rescue decide HOW MANY teams get offers. Refine only polishes the
      // best offers, so keep this capped hard to avoid drifting back toward the
      // old 5-minute brute-force search.
      maxEvaluationsPerTeam: Math.min(Number(baseProfile.maxEvaluationsPerTeam || MAX_EVALUATIONS_PER_TEAM), Number(refineSettings.evalCap || 0)),
      maxBasePackagesPerTeam: Math.min(Number(baseProfile.maxBasePackagesPerTeam || MAX_BASE_PACKAGES_PER_TEAM), Number(refineSettings.basePackageCap || 0)),
      maxBalanceRounds: Math.min(Number(baseProfile.maxBalanceRounds || 0), Number(refineSettings.maxBalanceRounds || 0)),
      maxAcceptedBaseSeeds: 1,
      baseEvalMinBeforeEarlyStop: 1,
      goodEnoughScore: Math.min(Number(baseProfile.goodEnoughScore || GOOD_ENOUGH_SCORE), refineSettings.mode === "ultra_fast" ? 7.5 : 8.0),
      stopAfterFirstAccepted: false,
      firstAcceptedImmediate: false,
      forcePickRecovery: Boolean(baseProfile.forcePickRecovery),
      maxPickRecoveryCandidates: Math.min(Number(baseProfile.maxPickRecoveryCandidates || 0), Number(refineSettings.maxPickRecoveryCandidates || 0)),
      perTeamBudgetMs: Math.min(Number(baseProfile.perTeamBudgetMs || refineSettings.perTeamBudgetMs || 4200), Number(refineSettings.perTeamBudgetMs || 4200)),
      missRisk: refineSettings.mode === "ultra_fast" ? "ultra_fast_refine_test" : "speed_capped_refined_top_teams",
    };
  }

  return {
    ...baseProfile,
    searchPhase: phase,
  };
}

function getTwoPassRefineLimit(profile = {}, scanOfferCount = 0) {
  if (scanOfferCount <= 0) return 0;
  const settings = getTradeFinderRefineSettings();
  const highValue = Boolean(profile?.forcePickRecovery || String(profile?.name || "").includes("superstar"));
  // Offer count comes from scan + always-rescue. Refinement is only a polish pass.
  // The default remains the current quality baseline. Ultra-fast is opt-in so we
  // can test sub-60s behavior without deleting the safer 26-offer baseline.
  const baseLimit = highValue ? settings.limitHighValue : settings.limitStandard;
  return Math.min(scanOfferCount, baseLimit);
}

function getTwoPassRescueTarget(profile = {}, teamCount = 0) {
  // Rescue is no longer a "low offer count only" safety net.
  // If a team missed in the scan, rescue should give that exact team a few
  // extra chances so Trade Finder does not quietly lose real offers.
  return Math.max(0, Number(teamCount || 0));
}

function getOfferRefinePriority(offer = null, profile = null) {
  if (!offer) return Infinity;
  const settings = getTradeFinderRefineSettings();
  const baseScore = scoreOffer(offer, profile);
  const gap = Number(offer.gap || 0);
  const pickCount = offerPickCount(offer);
  const underpay = Math.max(0, -gap);
  const noPickPenalty = profile?.forcePickRecovery && pickCount === 0 && underpay > 6 ? 14 : 0;
  const bigOverpayPenalty = Math.max(0, gap - 35) * 0.12;

  if (settings.priorityMode === "pick_underpay_first") {
    // In the ultra-fast experiment, use the tiny refinement budget on the teams
    // where scan most clearly found a CPU-lowball/pick-heavy shell that can be
    // upgraded into a much fairer offer.
    const pickUpgradeBonus = pickCount >= 3 ? -38 : pickCount > 0 ? -16 : 8;
    const underpayBonus = -underpay * 0.18;
    return baseScore * 0.18 + noPickPenalty + bigOverpayPenalty + pickUpgradeBonus + underpayBonus;
  }

  return baseScore + noPickPenalty + bigOverpayPenalty;
}

function shouldReplaceWithRefinedOffer(current = null, refined = null, profile = null) {
  if (!current) return Boolean(refined);
  if (!refined) return false;
  const currentScore = scoreOffer(current, profile);
  const refinedScore = scoreOffer(refined, profile);
  const currentPicks = offerPickCount(current);
  const refinedPicks = offerPickCount(refined);
  const currentGap = Number(current.gap || 0);
  const refinedGap = Number(refined.gap || 0);

  if (refinedScore <= currentScore + 1.25) return true;
  if (refinedGap > currentGap + 6) return true;
  if (refinedPicks > currentPicks && refinedGap >= currentGap - 5) return true;
  return false;
}

function makeTwoPassTeamCache() {
  return {
    cache: new Map(),
    financialCache: new Map(),
  };
}

function getTwoPassTeamCache(cacheMap, teamName = "") {
  const key = normalizeTeamName(teamName);
  if (!cacheMap.has(key)) cacheMap.set(key, makeTwoPassTeamCache());
  return cacheMap.get(key);
}

function makeTwoPassLoopSummary({ teamName, loopMs, offer, phase, timings = null }) {
  return {
    team: teamName,
    phase,
    ms: tfRoundMs(loopMs),
    foundOffer: Boolean(offer),
    evaluations: Number(timings?.evaluations ?? offer?.searchStats?.evaluations ?? 0),
    timings: timings || offer?.searchStats?.timings || null,
  };
}

function sumTwoPassMetric(rows = [], metricName = "") {
  return rows.reduce((sum, row) => sum + Number(row.timings?.[metricName] || 0), 0);
}

async function runTwoPassTradeFinderSearch({
  leagueData,
  selectedTeam,
  selectedItems,
  checkTeams,
  profile,
  onProgress = null,
  signal = null,
  searchStartedAt = tfDebugNow(),
}) {
  const selectedName = getTeamName(selectedTeam);
  const scanSummaries = [];
  const rescueSummaries = [];
  const refineSummaries = [];
  const refineDeltaSummaries = [];
  const offersByTeam = new Map();
  const scanOffers = [];
  const teamCaches = new Map();
  let __tfCancelled = false;
  let __tfBudgetStopped = false;
  let refinedOffers = 0;
  let replacedByRefine = 0;
  let removedApproximateByExactRefine = 0;
  let scanMs = 0;
  let rescueMs = 0;
  let refineMs = 0;

  tfDebugLog("two-pass search start", {
    selectedTeam: selectedName,
    selectedItems: tfItemsLabel(selectedItems),
    selectedValue: tfRoundMs(packageValue(selectedItems, leagueData)),
    teamsToCheck: checkTeams.length,
    baseProfile: profile,
    scanEvaluationsPerTeam: applyTradeFinderPhaseProfile(profile, "scan").maxEvaluationsPerTeam,
    refineLimit: getTwoPassRefineLimit(profile, checkTeams.length),
  });

  tfSafeProgress(onProgress, {
    phase: "scan_start",
    team: "",
    teamIndex: 0,
    teamsToCheck: checkTeams.length,
    offersFound: 0,
    elapsedSec: 0,
    searchMode: profile.mode,
    searchProfile: profile.name,
  });

  const scanStart = tfDebugNow();
  for (let teamIndex = 0; teamIndex < checkTeams.length; teamIndex += 1) {
    if (isTradeFinderSearchCancelled(signal)) {
      __tfCancelled = true;
      break;
    }

    const cpuTeam = checkTeams[teamIndex];
    const cpuName = getTeamName(cpuTeam);
    const teamCache = getTwoPassTeamCache(teamCaches, cpuName);
    const loopStart = tfDebugNow();

    tfSafeProgress(onProgress, {
      phase: "scan_team_start",
      team: cpuName,
      teamIndex: teamIndex + 1,
      teamsToCheck: checkTeams.length,
      offersFound: scanOffers.length,
      elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
    });

    await tfYieldToBrowser();

    let teamTimingSummary = null;
    const offer = await findBestOfferForTeam({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      onProgress,
      searchState: {
        teamIndex: teamIndex + 1,
        teamsToCheck: checkTeams.length,
        offersFound: scanOffers.length,
        searchStartedAt,
      },
      signal,
      searchMode: profile.mode,
      phaseProfile: profile,
      searchPhase: "scan",
      sharedCache: teamCache.cache,
      sharedFinancialCache: teamCache.financialCache,
      onTeamSummary: (summary) => { teamTimingSummary = summary; },
    });

    const loopMs = tfDebugNow() - loopStart;
    const loopSummary = makeTwoPassLoopSummary({ teamName: cpuName, loopMs, offer, phase: "scan", timings: teamTimingSummary });
    scanSummaries.push(loopSummary);
    if (offer) {
      scanOffers.push(offer);
      offersByTeam.set(normalizeTeamName(cpuName), offer);
    }

    if (isTradeFinderDebugEnabled() && loopMs >= TRADE_FINDER_SLOW_TEAM_MS) {
      tfDebugLog("two-pass scan team", loopSummary);
    }

    tfSafeProgress(onProgress, {
      phase: "scan_team_done",
      team: cpuName,
      teamIndex: teamIndex + 1,
      teamsToCheck: checkTeams.length,
      offersFound: scanOffers.length,
      teamMs: tfRoundMs(loopMs),
      evaluationsForTeam: loopSummary.evaluations,
      elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
    });

    await tfYieldToBrowser();
  }
  scanMs = tfDebugNow() - scanStart;

  const rescueTarget = getTwoPassRescueTarget(profile, checkTeams.length);
  const noOfferTeams = checkTeams.filter((team) => !offersByTeam.has(normalizeTeamName(getTeamName(team))));
  if (!__tfCancelled && noOfferTeams.length > 0) {
    const rescueStart = tfDebugNow();

    tfSafeProgress(onProgress, {
      phase: "rescue_start",
      team: "",
      teamIndex: 0,
      teamsToCheck: noOfferTeams.length,
      offersFound: scanOffers.length,
      elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
      rescueTarget,
      rescueMissedTeams: noOfferTeams.length,
    });

    for (let rescueIndex = 0; rescueIndex < noOfferTeams.length; rescueIndex += 1) {
      if (isTradeFinderSearchCancelled(signal)) {
        __tfCancelled = true;
        break;
      }

      const cpuTeam = noOfferTeams[rescueIndex];
      const cpuName = getTeamName(cpuTeam);
      const teamCache = getTwoPassTeamCache(teamCaches, cpuName);
      const loopStart = tfDebugNow();

      tfSafeProgress(onProgress, {
        phase: "rescue_team_start",
        team: cpuName,
        teamIndex: rescueIndex + 1,
        teamsToCheck: noOfferTeams.length,
        offersFound: scanOffers.length,
        elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
      });

      await tfYieldToBrowser();

      let teamTimingSummary = null;
      const offer = await findBestOfferForTeam({
        leagueData,
        selectedTeam,
        cpuTeam,
        selectedItems,
        onProgress,
        searchState: {
          teamIndex: rescueIndex + 1,
          teamsToCheck: noOfferTeams.length,
          offersFound: scanOffers.length,
          searchStartedAt,
        },
        signal,
        searchMode: profile.mode,
        phaseProfile: profile,
        searchPhase: "rescue",
        sharedCache: teamCache.cache,
        sharedFinancialCache: teamCache.financialCache,
        onTeamSummary: (summary) => { teamTimingSummary = summary; },
      });

      const loopMs = tfDebugNow() - loopStart;
      const loopSummary = makeTwoPassLoopSummary({ teamName: cpuName, loopMs, offer, phase: "rescue", timings: teamTimingSummary });
      rescueSummaries.push(loopSummary);
      if (offer) {
        scanOffers.push(offer);
        offersByTeam.set(normalizeTeamName(cpuName), offer);
      }

      if (isTradeFinderDebugEnabled() && loopMs >= TRADE_FINDER_SLOW_TEAM_MS) {
        tfDebugLog("two-pass rescue team", loopSummary);
      }

      tfSafeProgress(onProgress, {
        phase: "rescue_team_done",
        team: cpuName,
        teamIndex: rescueIndex + 1,
        teamsToCheck: noOfferTeams.length,
        offersFound: scanOffers.length,
        teamMs: tfRoundMs(loopMs),
        evaluationsForTeam: loopSummary.evaluations,
        elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
      });

      await tfYieldToBrowser();
    }

    rescueMs = tfDebugNow() - rescueStart;
  }

  const refineSettings = getTradeFinderRefineSettings();
  const refineCandidates = [...offersByTeam.values()]
    .sort((a, b) => getOfferRefinePriority(a, profile) - getOfferRefinePriority(b, profile))
    .slice(0, getTwoPassRefineLimit(profile, offersByTeam.size));

  if (!__tfCancelled && refineCandidates.length) {
    const refineStart = tfDebugNow();
    tfSafeProgress(onProgress, {
      phase: "refine_start",
      team: "",
      teamIndex: 0,
      teamsToCheck: refineCandidates.length,
      offersFound: offersByTeam.size,
      elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
    });

    for (let refineIndex = 0; refineIndex < refineCandidates.length; refineIndex += 1) {
      if (isTradeFinderSearchCancelled(signal)) {
        __tfCancelled = true;
        break;
      }
      if (Number(refineSettings.refineTimeBudgetMs || 0) > 0 && tfDebugNow() - refineStart >= Number(refineSettings.refineTimeBudgetMs || 0)) {
        tfDebugLog("two-pass refine time budget reached", {
          refineIndex,
          refineTimeBudgetMs: refineSettings.refineTimeBudgetMs,
          elapsedRefineMs: tfRoundMs(tfDebugNow() - refineStart),
        });
        break;
      }

      const currentOffer = refineCandidates[refineIndex];
      const cpuTeam = currentOffer.team;
      const cpuName = getTeamName(cpuTeam);
      const teamCache = getTwoPassTeamCache(teamCaches, cpuName);
      const loopStart = tfDebugNow();

      tfSafeProgress(onProgress, {
        phase: "refine_team_start",
        team: cpuName,
        teamIndex: refineIndex + 1,
        teamsToCheck: refineCandidates.length,
        offersFound: offersByTeam.size,
        elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
      });

      await tfYieldToBrowser();

      const teamKey = normalizeTeamName(cpuName);
      let exactCurrentOffer = currentOffer;
      let removedCurrentApproximateOffer = false;

      // Scan/rescue can use the fast-scan impact approximation for speed.
      // Before a scan/rescue offer is allowed to survive the final refine list,
      // validate that exact same offer with the Builder-style exact path.
      // This catches cases like Cavs Mitchell + Mobley where fast-scan says
      // accept, but Propose Trade correctly rejects by a huge margin.
      if (isApproximateTradeFinderOffer(currentOffer)) {
        const exactValidationStart = tfDebugNow();
        const exactValidationState = makeExactRefineEvalState({
          profile,
          sharedCache: teamCache.cache,
          sharedFinancialCache: teamCache.financialCache,
          teamStartedAt: loopStart,
          searchStartedAt,
        });

        exactCurrentOffer = evaluateCpuOfferPackage({
          leagueData,
          selectedTeam,
          cpuTeam,
          selectedItems,
          cpuItems: currentOffer.offer,
          evalState: exactValidationState,
        });

        if (!exactCurrentOffer) {
          offersByTeam.delete(teamKey);
          removedCurrentApproximateOffer = true;
          removedApproximateByExactRefine += 1;
          tfDebugLog("two-pass refine removed scan-only offer after exact check", {
            team: cpuName,
            exactCheckMs: tfRoundMs(tfDebugNow() - exactValidationStart),
            startGap: tfRoundMs(currentOffer?.gap),
            startComfortMargin: tfRoundMs(currentOffer?.comfortMargin),
            startEvaluationPath: currentOffer?.finderEvaluationPath || currentOffer?.finderEvaluationMode || "unknown",
          });
        } else {
          offersByTeam.set(teamKey, exactCurrentOffer);
          tfDebugLog("two-pass refine exact-check kept approximate offer", {
            team: cpuName,
            exactCheckMs: tfRoundMs(tfDebugNow() - exactValidationStart),
            exactGap: tfRoundMs(exactCurrentOffer?.gap),
            exactComfortMargin: tfRoundMs(exactCurrentOffer?.comfortMargin),
            exactEvaluationPath: exactCurrentOffer?.finderEvaluationPath || exactCurrentOffer?.finderEvaluationMode || "exact",
          });
        }
      }

      let teamTimingSummary = null;
      const refined = removedCurrentApproximateOffer ? null : await findBestOfferForTeam({
        leagueData,
        selectedTeam,
        cpuTeam,
        selectedItems,
        onProgress,
        searchState: {
          teamIndex: refineIndex + 1,
          teamsToCheck: refineCandidates.length,
          offersFound: offersByTeam.size,
          searchStartedAt,
        },
        signal,
        searchMode: profile.mode,
        phaseProfile: profile,
        searchPhase: "refine",
        sharedCache: teamCache.cache,
        sharedFinancialCache: teamCache.financialCache,
        onTeamSummary: (summary) => { teamTimingSummary = summary; },
      });

      const loopMs = tfDebugNow() - loopStart;
      const loopSummary = makeTwoPassLoopSummary({ teamName: cpuName, loopMs, offer: refined, phase: "refine", timings: teamTimingSummary });
      refineSummaries.push(loopSummary);

      const current = offersByTeam.get(teamKey) || exactCurrentOffer || currentOffer;
      if (refined) refinedOffers += 1;
      const replaced = shouldReplaceWithRefinedOffer(current, refined, profile);
      if (replaced) {
        offersByTeam.set(teamKey, refined);
        replacedByRefine += 1;
      }
      const finalForTeam = offersByTeam.get(teamKey) || (removedCurrentApproximateOffer ? null : current);
      refineDeltaSummaries.push({
        team: cpuName,
        ms: tfRoundMs(loopMs),
        evaluations: loopSummary.evaluations,
        foundOffer: Boolean(refined),
        replaced,
        removedApproximateByExactRefine: removedCurrentApproximateOffer,
        startGap: tfRoundMs(current?.gap),
        finalGap: tfRoundMs(finalForTeam?.gap),
        startPickCount: offerPickCount(current),
        finalPickCount: offerPickCount(finalForTeam),
        startScore: tfRoundMs(scoreOffer(current, profile)),
        finalScore: tfRoundMs(scoreOffer(finalForTeam, profile)),
      });

      if (isTradeFinderDebugEnabled() && loopMs >= TRADE_FINDER_SLOW_TEAM_MS) {
        tfDebugLog("two-pass refine team", {
          ...loopSummary,
          replaced: offersByTeam.get(teamKey) === refined,
          removedApproximateByExactRefine: removedCurrentApproximateOffer,
          startGap: tfRoundMs(current?.gap),
          finalGap: tfRoundMs((offersByTeam.get(teamKey) || current)?.gap),
          startPickCount: offerPickCount(current),
          finalPickCount: offerPickCount(offersByTeam.get(teamKey) || current),
        });
      }

      tfSafeProgress(onProgress, {
        phase: "refine_team_done",
        team: cpuName,
        teamIndex: refineIndex + 1,
        teamsToCheck: refineCandidates.length,
        offersFound: offersByTeam.size,
        teamMs: tfRoundMs(loopMs),
        evaluationsForTeam: loopSummary.evaluations,
        elapsedSec: tfRoundMs((tfDebugNow() - searchStartedAt) / 1000),
      });

      await tfYieldToBrowser();
    }
    refineMs = tfDebugNow() - refineStart;
  }

  const offers = [...offersByTeam.values()]
    .map((offer) => ({ ...offer, offer: sortTradeFinderOfferItems(offer.offer, leagueData) }))
    .sort((a, b) => scoreOffer(a, profile) - scoreOffer(b, profile) || String(getTeamName(a.team)).localeCompare(getTeamName(b.team)));

  const allSummaries = [...scanSummaries, ...rescueSummaries, ...refineSummaries];
  const __tfTotalMs = tfDebugNow() - searchStartedAt;
  const __tfTotalEvaluations = allSummaries.reduce((sum, row) => sum + Number(row.evaluations || 0), 0);
  const scanEvaluations = scanSummaries.reduce((sum, row) => sum + Number(row.evaluations || 0), 0);
  const rescueEvaluations = rescueSummaries.reduce((sum, row) => sum + Number(row.evaluations || 0), 0);
  const refineEvaluations = refineSummaries.reduce((sum, row) => sum + Number(row.evaluations || 0), 0);
  const __tfDebugResult = {
    totalMs: tfRoundMs(__tfTotalMs),
    totalSec: tfRoundMs(__tfTotalMs / 1000),
    offersFound: offers.length,
    teamsChecked: checkTeams.length,
    totalEvaluations: __tfTotalEvaluations,
    asyncChunked: true,
    twoPass: true,
    stopped: __tfCancelled,
    budgetStopped: __tfBudgetStopped,
    teamsProcessed: scanSummaries.length,
    searchProfile: profile.name,
    searchMode: profile.mode,
    missRisk: "two_pass_scan_refine",
    forcePickRecovery: Boolean(profile.forcePickRecovery),
    firstAcceptedImmediate: false,
    scanOffersFound: scanOffers.length,
    refinedTeams: refineCandidates.length,
    refineCandidateTeams: refineCandidates.map((offer) => getTeamName(offer.team)),
    refinePolicy: refineSettings.policy,
    refineMode: refineSettings.mode,
    refineEvalCap: applyTradeFinderPhaseProfile(profile, "refine").maxEvaluationsPerTeam,
    refineTimeBudgetMs: refineSettings.refineTimeBudgetMs,
    refinedOffers,
    replacedByRefine,
    removedApproximateByExactRefine,
    scanEvaluations,
    rescueEvaluations,
    refineEvaluations,
    scanMissedTeams: noOfferTeams.length,
    rescueTeamsAttempted: rescueSummaries.length,
    rescueOffersFound: rescueSummaries.filter((row) => row.foundOffer).length,
    scanMs: tfRoundMs(scanMs),
    rescueMs: tfRoundMs(rescueMs),
    refineMs: tfRoundMs(refineMs),
    totalImpactMs: tfRoundMs(sumTwoPassMetric(allSummaries, "impactMs")),
    totalFinancialMs: tfRoundMs(sumTwoPassMetric(allSummaries, "financialMs")),
    totalYieldMs: tfRoundMs(sumTwoPassMetric(allSummaries, "yieldMs")),
    totalHiddenMs: tfRoundMs(sumTwoPassMetric(allSummaries, "hiddenMs")),
    totalImpactCacheHits: allSummaries.reduce((sum, row) => sum + Number(row.timings?.impactCacheHits || 0), 0),
    totalFinancialCacheHits: allSummaries.reduce((sum, row) => sum + Number(row.timings?.financialCacheHits || 0), 0),
    refineDeltaSummaries,
    finalOfferSummaries: offers.map((offer, index) => ({
      rank: index + 1,
      team: getTeamName(offer.team),
      value: tfRoundMs(offer.offerValue),
      gap: tfRoundMs(offer.gap),
      comfortMargin: tfRoundMs(offer.comfortMargin),
      pickCount: offerPickCount(offer),
      assetCount: Array.isArray(offer.offer) ? offer.offer.length : 0,
      score: tfRoundMs(scoreOffer(offer, profile)),
      quality: offer.quality || "Accepted Offer",
    })).slice(0, 30),
    slowestTeams: allSummaries.slice().sort((a, b) => b.ms - a.ms).slice(0, 10),
    teamSummaries: allSummaries,
    scanTeamSummaries: scanSummaries,
    rescueTeamSummaries: rescueSummaries,
    refineTeamSummaries: refineSummaries,
  };

  try {
    if (typeof window !== "undefined") window.__TF_LAST_DEBUG = __tfDebugResult;
  } catch {}

  tfDebugLog("two-pass search complete", __tfDebugResult);

  tfSafeProgress(onProgress, {
    phase: __tfCancelled ? "stopped" : "complete",
    team: "",
    teamIndex: scanSummaries.length,
    teamsToCheck: checkTeams.length,
    offersFound: offers.length,
    elapsedSec: tfRoundMs(__tfTotalMs / 1000),
    twoPass: true,
  });

  return {
    offers,
    checkedTeams: checkTeams.length,
    debug: __tfDebugResult,
    stopped: __tfCancelled,
    message: __tfCancelled
      ? `Search stopped during two-pass search after ${scanSummaries.length}/${checkTeams.length} scanned teams. Found ${offers.length} offer${offers.length === 1 ? "" : "s"}.`
      : offers.length
        ? `Found ${offers.length} CPU-comfortable offer${offers.length === 1 ? "" : "s"} with two-pass scan/refine.`
        : "No CPU team found a Propose Trade-legal package it would comfortably accept.",
  };
}

async function findBestOfferForTeam({
  leagueData,
  selectedTeam,
  cpuTeam,
  selectedItems,
  onProgress = null,
  searchState = null,
  signal = null,
  searchMode = "accurate",
  searchPhase = "single",
  phaseProfile = null,
  sharedCache = null,
  sharedFinancialCache = null,
  onTeamSummary = null,
}) {
  const __tfTeamStart = tfDebugNow();
  const __tfTeamName = getTeamName(cpuTeam);
  const baseProfile = phaseProfile || getTradeFinderSearchProfile(selectedItems, leagueData, searchMode);
  const profile = applyTradeFinderPhaseProfile(baseProfile, searchPhase);
  if (isTradeFinderSearchCancelled(signal)) return null;
  const __tfCandidateStart = tfDebugNow();
  const { players, picks, candidates, playerPool, balancePlayers, balancePicks } = getCandidateAssets(cpuTeam, leagueData);
  const __tfCandidateMs = tfDebugNow() - __tfCandidateStart;
  if (!candidates.length) {
    tfDebugLog("team skipped - no candidates", { team: __tfTeamName, candidateMs: tfRoundMs(__tfCandidateMs) });
    return null;
  }

  const evalState = {
    cache: sharedCache || new Map(),
    financialCache: sharedFinancialCache || new Map(),
    count: 0,
    profile,
    teamStartedAt: __tfTeamStart,
    searchStartedAt: Number(searchState?.searchStartedAt || 0),
    metrics: {
      candidateMs: __tfCandidateMs,
      basePackageMs: 0,
      impactMs: 0,
      finalValidationMs: 0,
      financialMs: 0,
      yieldMs: 0,
      impactCacheHits: 0,
      preRejected: 0,
      cacheHits: 0,
      financialCacheHits: 0,
      cpuRejected: 0,
      comfortRejected: 0,
      finalRejected: 0,
      accepted: 0,
    },
  };
  const __tfBasePackageStart = tfDebugNow();
  const allBasePackages = buildBasePackages({ leagueData, selectedTeam, cpuTeam, selectedItems, players, picks, candidates, playerPool, profile });
  const basePackages = allBasePackages.slice(0, Number(profile.maxBasePackagesPerTeam || MAX_BASE_PACKAGES_PER_TEAM));
  evalState.metrics.basePackageMs = tfDebugNow() - __tfBasePackageStart;
  const acceptedBases = [];
  let best = null;
  let bestScore = Infinity;

  const makeTeamSummary = () => {
    const __tfTeamMs = tfDebugNow() - __tfTeamStart;
    return {
      team: __tfTeamName,
      phase: searchPhase,
      baseSearchProfile: baseProfile.name,
      totalMs: tfRoundMs(__tfTeamMs),
      candidateMs: tfRoundMs(evalState.metrics.candidateMs),
      basePackageMs: tfRoundMs(evalState.metrics.basePackageMs),
      impactMs: tfRoundMs(evalState.metrics.impactMs),
      finalValidationMs: tfRoundMs(evalState.metrics.finalValidationMs),
      financialMs: tfRoundMs(evalState.metrics.financialMs),
      yieldMs: tfRoundMs(evalState.metrics.yieldMs),
      hiddenMs: tfRoundMs(__tfTeamMs - evalState.metrics.candidateMs - evalState.metrics.basePackageMs - evalState.metrics.impactMs - evalState.metrics.finalValidationMs - evalState.metrics.financialMs - evalState.metrics.yieldMs),
      basePackages: basePackages.length,
      basePackagesGenerated: allBasePackages.length,
      searchProfile: profile.name,
      evaluations: evalState.count,
      acceptedCandidates: evalState.metrics.accepted,
      preRejected: evalState.metrics.preRejected,
      cpuRejected: evalState.metrics.cpuRejected,
      comfortRejected: evalState.metrics.comfortRejected,
      finalRejected: evalState.metrics.finalRejected,
      cacheHits: evalState.metrics.cacheHits,
      financialCacheHits: evalState.metrics.financialCacheHits,
      impactCacheHits: evalState.metrics.impactCacheHits,
      foundOffer: Boolean(best),
      bestGap: best ? tfRoundMs(best.gap) : null,
      bestPickCount: offerPickCount(best),
      forcePickRecovery: Boolean(profile.forcePickRecovery),
      searchMode: profile.mode,
      missRisk: profile.missRisk,
      bestScore: Number.isFinite(bestScore) ? tfRoundMs(bestScore) : null,
    };
  };

  for (let i = 0; i < basePackages.length; i += 1) {
    if (isTradeFinderSearchCancelled(signal)) break;
    if (evalState.count >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState) || hasSearchTimeBudgetExpired(evalState)) break;
    const basePackage = basePackages[i];
    const evaluated = evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: basePackage, evalState });

    if (evalState.count && evalState.count % TRADE_FINDER_YIELD_EVERY_EVALUATIONS === 0) {
      tfSafeProgress(onProgress, {
        phase: searchPhase === "scan" ? "scan_evaluating" : searchPhase === "rescue" ? "rescue_evaluating" : searchPhase === "refine" ? "refine_evaluating" : "evaluating",
        team: __tfTeamName,
        teamIndex: searchState?.teamIndex || 0,
        teamsToCheck: searchState?.teamsToCheck || 0,
        evaluationsForTeam: evalState.count,
        offersFound: searchState?.offersFound || 0,
      });
      await tfYieldToBrowser(evalState.metrics);
    }

    if (!evaluated) continue;

    acceptedBases.push(evaluated);
    const evaluatedScore = scoreOffer(evaluated, profile);
    if (evaluatedScore < bestScore) {
      best = evaluated;
      bestScore = evaluatedScore;
    }

    if (profile.firstAcceptedImmediate && acceptedBases.length >= 1) break;
    if (i >= profile.baseEvalMinBeforeEarlyStop && acceptedBases.length >= profile.maxAcceptedBaseSeeds) break;
    if (i >= profile.baseEvalMinBeforeEarlyStop && bestScore <= profile.goodEnoughScore) break;
    if (profile.stopAfterFirstAccepted && i >= profile.baseEvalMinBeforeEarlyStop && acceptedBases.length >= 1) break;
  }

  if (!acceptedBases.length) {
    const __tfSummary = makeTeamSummary();
    if (typeof onTeamSummary === "function") {
      try { onTeamSummary(__tfSummary); } catch {}
    }
    if (isTradeFinderDebugEnabled() && __tfSummary.totalMs >= TRADE_FINDER_SLOW_TEAM_MS) {
      tfDebugLog("team checked", __tfSummary);
    }
    return null;
  }

  const balanceSeeds = acceptedBases.sort((a, b) => scoreOffer(a, profile) - scoreOffer(b, profile)).slice(0, profile.maxAcceptedBaseSeeds || MAX_ACCEPTED_BASE_SEEDS);

  for (const seed of balanceSeeds) {
    if (isTradeFinderSearchCancelled(signal)) break;
    if (evalState.count >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState) || hasSearchTimeBudgetExpired(evalState)) break;
    if (profile.maxBalanceRounds <= 0) break;

    const playerBalanced = await tryBalanceWithAdditionalAssets({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      startResult: seed,
      additions: balancePlayers,
      evalState,
      signal,
    });
    const pickBalanced = await tryBalanceWithAdditionalAssets({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      startResult: playerBalanced || seed,
      additions: balancePicks,
      evalState,
      signal,
    });
    const candidate = pickBalanced || playerBalanced || seed;
    const candidateScore = scoreOffer(candidate, profile);

    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }

    if (bestScore <= profile.goodEnoughScore) break;
  }

  if (best && shouldRunPickRecovery(best, profile)) {
    best = await tryPickRecovery({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      startResult: best,
      picks: balancePicks,
      evalState,
      signal,
    });
    bestScore = scoreOffer(best, profile);
  }

  const __tfSummary = makeTeamSummary();
  if (typeof onTeamSummary === "function") {
    try { onTeamSummary(__tfSummary); } catch {}
  }
  if (isTradeFinderDebugEnabled() && (__tfSummary.totalMs >= TRADE_FINDER_SLOW_TEAM_MS || best)) {
    tfDebugLog("team checked", __tfSummary);
  }

  return best
    ? {
        ...best,
        offer: sortTradeFinderOfferItems(best.offer, leagueData),
        searchStats: {
          evaluations: evalState.count,
          timings: __tfSummary,
        },
      }
    : null;
}

export async function findComfortableTradeFinderOffers({ leagueData, selectedTeam, selectedItems = [], teams = [], onProgress = null, signal = null, searchMode = "accurate" } = {}) {
  if (!leagueData || !selectedTeam) {
    return { offers: [], message: "Trade Finder needs a loaded league and selected team." };
  }

  if (!Array.isArray(selectedItems) || !selectedItems.length) {
    return { offers: [], message: "Add at least one asset before searching." };
  }

  if (selectedItems.length > MAX_SIDE_ITEMS) {
    return { offers: [], message: `Each side can include up to ${MAX_SIDE_ITEMS} trade assets.` };
  }

  const allTeams = Array.isArray(teams) && teams.length ? teams : getAllTeamsFromLeague(leagueData);
  const selectedName = getTeamName(selectedTeam);
  const checkTeams = allTeams.filter((team) => {
    const cpuName = getTeamName(team);
    return Boolean(cpuName && !sameTeamName(cpuName, selectedName));
  });
  const offers = [];
  const profile = getTradeFinderSearchProfile(selectedItems, leagueData, searchMode);
  const __tfSearchStart = tfDebugNow();
  const __tfTeamSummaries = [];
  let __tfCancelled = false;
  let __tfBudgetStopped = false;

  tfDebugLog("search start", {
    selectedTeam: selectedName,
    selectedItems: tfItemsLabel(selectedItems),
    selectedValue: tfRoundMs(packageValue(selectedItems, leagueData)),
    teamsToCheck: checkTeams.length,
    searchProfile: profile,
    searchMode: profile.mode,
    maxEvaluationsPerTeam: profile.maxEvaluationsPerTeam,
    theoreticalWorstCaseEvaluations: checkTeams.length * profile.maxEvaluationsPerTeam,
    asyncChunked: true,
  });

  tfSafeProgress(onProgress, {
    phase: "start",
    team: "",
    teamIndex: 0,
    teamsToCheck: checkTeams.length,
    offersFound: 0,
    elapsedSec: 0,
    searchMode: profile.mode,
    searchProfile: profile.name,
  });

  if (shouldUseTwoPassTradeFinderSearch(profile, selectedItems, leagueData)) {
    return runTwoPassTradeFinderSearch({
      leagueData,
      selectedTeam,
      selectedItems,
      checkTeams,
      profile,
      onProgress,
      signal,
      searchStartedAt: __tfSearchStart,
    });
  }

  for (let teamIndex = 0; teamIndex < checkTeams.length; teamIndex += 1) {
    if (isTradeFinderSearchCancelled(signal)) {
      __tfCancelled = true;
      break;
    }
    if (profile.maxSearchMs > 0 && tfDebugNow() - __tfSearchStart >= profile.maxSearchMs) {
      __tfCancelled = true;
      __tfBudgetStopped = true;
      break;
    }

    const cpuTeam = checkTeams[teamIndex];
    const cpuName = getTeamName(cpuTeam);
    const __tfLoopStart = tfDebugNow();

    tfSafeProgress(onProgress, {
      phase: "team_start",
      team: cpuName,
      teamIndex: teamIndex + 1,
      teamsToCheck: checkTeams.length,
      offersFound: offers.length,
      elapsedSec: tfRoundMs((tfDebugNow() - __tfSearchStart) / 1000),
    });

    await tfYieldToBrowser();

    const offer = await findBestOfferForTeam({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      onProgress,
      searchState: {
        teamIndex: teamIndex + 1,
        teamsToCheck: checkTeams.length,
        offersFound: offers.length,
        searchStartedAt: __tfSearchStart,
      },
      signal,
      searchMode: profile.mode,
    });

    const __tfLoopMs = tfDebugNow() - __tfLoopStart;
    const __tfLoopSummary = {
      team: cpuName,
      ms: tfRoundMs(__tfLoopMs),
      foundOffer: Boolean(offer),
      evaluations: Number(offer?.searchStats?.evaluations || 0),
      timings: offer?.searchStats?.timings || null,
    };
    __tfTeamSummaries.push(__tfLoopSummary);
    if (offer) offers.push(offer);
    if (isTradeFinderSearchCancelled(signal)) {
      __tfCancelled = true;
    }
    if (isTradeFinderDebugEnabled() && __tfLoopMs >= TRADE_FINDER_SLOW_TEAM_MS) {
      tfDebugLog("slow team loop", __tfLoopSummary);
    }

    tfSafeProgress(onProgress, {
      phase: "team_done",
      team: cpuName,
      teamIndex: teamIndex + 1,
      teamsToCheck: checkTeams.length,
      offersFound: offers.length,
      teamMs: tfRoundMs(__tfLoopMs),
      evaluationsForTeam: __tfLoopSummary.evaluations,
      elapsedSec: tfRoundMs((tfDebugNow() - __tfSearchStart) / 1000),
    });

    await tfYieldToBrowser();
  }

  offers.sort((a, b) => scoreOffer(a, profile) - scoreOffer(b, profile) || String(getTeamName(a.team)).localeCompare(getTeamName(b.team)));

  const __tfTotalMs = tfDebugNow() - __tfSearchStart;
  const __tfTotalEvaluations = __tfTeamSummaries.reduce((sum, row) => sum + Number(row.evaluations || 0), 0);
  const __tfDebugResult = {
    totalMs: tfRoundMs(__tfTotalMs),
    totalSec: tfRoundMs(__tfTotalMs / 1000),
    offersFound: offers.length,
    teamsChecked: checkTeams.length,
    totalEvaluations: __tfTotalEvaluations,
    asyncChunked: true,
    stopped: __tfCancelled,
    budgetStopped: __tfBudgetStopped,
    teamsProcessed: __tfTeamSummaries.length,
    searchProfile: profile.name,
    searchMode: profile.mode,
    missRisk: profile.missRisk,
    forcePickRecovery: Boolean(profile.forcePickRecovery),
    firstAcceptedImmediate: Boolean(profile.firstAcceptedImmediate),
    totalImpactMs: tfRoundMs(__tfTeamSummaries.reduce((sum, row) => sum + Number(row.timings?.impactMs || 0), 0)),
    totalFinancialMs: tfRoundMs(__tfTeamSummaries.reduce((sum, row) => sum + Number(row.timings?.financialMs || 0), 0)),
    totalYieldMs: tfRoundMs(__tfTeamSummaries.reduce((sum, row) => sum + Number(row.timings?.yieldMs || 0), 0)),
    totalHiddenMs: tfRoundMs(__tfTeamSummaries.reduce((sum, row) => sum + Number(row.timings?.hiddenMs || 0), 0)),
    totalImpactCacheHits: __tfTeamSummaries.reduce((sum, row) => sum + Number(row.timings?.impactCacheHits || 0), 0),
    totalFinancialCacheHits: __tfTeamSummaries.reduce((sum, row) => sum + Number(row.timings?.financialCacheHits || 0), 0),
    slowestTeams: __tfTeamSummaries.slice().sort((a, b) => b.ms - a.ms).slice(0, 8),
    teamSummaries: __tfTeamSummaries,
  };

  try {
    if (typeof window !== "undefined") window.__TF_LAST_DEBUG = __tfDebugResult;
  } catch {}

  tfDebugLog("search complete", __tfDebugResult);

  tfSafeProgress(onProgress, {
    phase: __tfCancelled ? "stopped" : "complete",
    team: "",
    teamIndex: checkTeams.length,
    teamsToCheck: checkTeams.length,
    offersFound: offers.length,
    elapsedSec: tfRoundMs(__tfTotalMs / 1000),
  });

  return {
    offers,
    checkedTeams: checkTeams.length,
    debug: __tfDebugResult,
    stopped: __tfCancelled,
    message: __tfCancelled
      ? (__tfBudgetStopped
          ? `Fast Preview reached its time budget after ${__tfTeamSummaries.length}/${checkTeams.length} teams. Found ${offers.length} preview offer${offers.length === 1 ? "" : "s"}. Use Accurate Search to keep checking.`
          : `Search stopped after ${__tfTeamSummaries.length}/${checkTeams.length} teams. Found ${offers.length} offer${offers.length === 1 ? "" : "s"}.`)
      : offers.length
        ? `Found ${offers.length} CPU-comfortable offer${offers.length === 1 ? "" : "s"}.`
        : "No CPU team found a Propose Trade-legal package it would comfortably accept.",
  };
}
