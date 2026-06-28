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

function getTradeFinderSearchProfile(selectedItems = []) {
  const counts = countTradeFinderItemTypes(selectedItems);

  // Big multi-player packages are expensive because each evaluated CPU offer
  // requires a full post-trade team-impact pass. Keep the same acceptance logic,
  // but avoid over-refining after we already found a legal comfortable offer.
  if (counts.playerCount >= 3 || counts.assetCount >= 4) {
    return {
      name: "large_package_fast",
      reason: "3+ outgoing players/assets",
      maxEvaluationsPerTeam: 8,
      maxBasePackagesPerTeam: 12,
      maxBalanceRounds: 0,
      maxAcceptedBaseSeeds: 1,
      baseEvalMinBeforeEarlyStop: 2,
      goodEnoughScore: 20,
      stopAfterFirstAccepted: true,
      perTeamBudgetMs: 2500,
      maxNoAcceptedEvaluations: 2,
      hardRejectStopScore: -10,
      weakRejectStopScore: 2,
    };
  }

  if (counts.playerCount >= 2 || counts.assetCount >= 2) {
    return {
      name: "medium_package_balanced",
      reason: "2 outgoing assets/players",
      maxEvaluationsPerTeam: 26,
      maxBasePackagesPerTeam: 24,
      maxBalanceRounds: 1,
      maxAcceptedBaseSeeds: 2,
      baseEvalMinBeforeEarlyStop: 8,
      goodEnoughScore: 12,
      stopAfterFirstAccepted: false,
      perTeamBudgetMs: 16000,
    };
  }

  return {
    name: "standard_deep",
    reason: "single outgoing asset",
    maxEvaluationsPerTeam: MAX_EVALUATIONS_PER_TEAM,
    maxBasePackagesPerTeam: MAX_BASE_PACKAGES_PER_TEAM,
    maxBalanceRounds: MAX_BALANCE_ROUNDS,
    maxAcceptedBaseSeeds: MAX_ACCEPTED_BASE_SEEDS,
    baseEvalMinBeforeEarlyStop: BASE_EVAL_MIN_BEFORE_EARLY_STOP,
    goodEnoughScore: GOOD_ENOUGH_SCORE,
    stopAfterFirstAccepted: false,
    perTeamBudgetMs: 0,
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

function shouldStopNoOfferSearch(evalState = null, acceptedBases = []) {
  if (!evalState?.profile || (Array.isArray(acceptedBases) && acceptedBases.length > 0)) return false;

  const count = Number(evalState.count || 0);
  if (count <= 0) return false;

  const bestRawScore = Number(evalState?.metrics?.bestRawScore ?? -Infinity);
  const hardRejectStopScore = Number(evalState.profile.hardRejectStopScore);
  if (Number.isFinite(bestRawScore) && Number.isFinite(hardRejectStopScore) && bestRawScore <= hardRejectStopScore) {
    if (evalState.metrics) evalState.metrics.noOfferEarlyStop = "hard_reject_score";
    return true;
  }

  const maxNoAcceptedEvaluations = Number(evalState.profile.maxNoAcceptedEvaluations || 0);
  const weakRejectStopScore = Number(evalState.profile.weakRejectStopScore);
  if (
    maxNoAcceptedEvaluations > 0 &&
    count >= maxNoAcceptedEvaluations &&
    (!Number.isFinite(weakRejectStopScore) || bestRawScore <= weakRejectStopScore)
  ) {
    if (evalState.metrics) evalState.metrics.noOfferEarlyStop = "no_accepted_eval_limit";
    return true;
  }

  return false;
}

const TRADE_FINDER_YIELD_EVERY_EVALUATIONS = 1;

function tfYieldToBrowser() {
  return new Promise((resolve) => {
    try {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => setTimeout(resolve, 0));
        return;
      }
    } catch {}
    setTimeout(resolve, 0);
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
  return emptyPenalty + gap + underPenalty + pickCount * 2.2 - playerCount * 1.4 + items.length * 0.35;
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

  for (const pick of picks.slice().sort((a, b) => a.value - b.value)) {
    if (pkg.length >= MAX_SIDE_ITEMS) break;
    if (used.has(itemFamilyKey(pick))) continue;
    const currentGap = Math.abs(targetValue - total);
    const nextTotal = total + assetValue(pick, leagueData);
    const nextGap = Math.abs(targetValue - nextTotal);
    if (nextGap > currentGap * 0.98 && total >= targetValue * 0.5) continue;
    pkg.push(pick);
    used.add(itemFamilyKey(pick));
    total = nextTotal;
    if (total >= targetValue * 0.88) break;
  }

  return pkg;
}

function buildBasePackages({ leagueData, selectedTeam, cpuTeam, selectedItems, players, picks, candidates, playerPool }) {
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

function preValidatePackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems }) {
  if (!Array.isArray(cpuItems) || !cpuItems.length || cpuItems.length > MAX_SIDE_ITEMS) return false;
  if (!Array.isArray(selectedItems) || !selectedItems.length || selectedItems.length > MAX_SIDE_ITEMS) return false;
  return financialOk({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems });
}

function evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems, evalState }) {
  const __tfEvalStart = tfDebugNow();
  const __tfTeamName = getTeamName(cpuTeam);
  const __tfItemLabel = tfItemsLabel(cpuItems);

  if (!preValidatePackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems })) {
    if (evalState?.metrics) evalState.metrics.preRejected = Number(evalState.metrics.preRejected || 0) + 1;
    return null;
  }

  const key = packageKey(cpuItems);
  if (evalState?.cache?.has(key)) {
    if (evalState?.metrics) evalState.metrics.cacheHits = Number(evalState.metrics.cacheHits || 0) + 1;
    return evalState.cache.get(key);
  }
  if (evalState) evalState.count = Number(evalState.count || 0) + 1;

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
    cpuTradeContext: { source: "trade_finder_offer_engine" },
  });
  const __tfImpactMs = tfDebugNow() - __tfImpactStart;
  if (evalState?.metrics) {
    const __tfScore = Number(evaluation?.score || 0);
    const __tfThreshold = Number(evaluation?.teamImpact?.threshold || 0);
    evalState.metrics.impactMs = Number(evalState.metrics.impactMs || 0) + __tfImpactMs;
    evalState.metrics.lastRawScore = __tfScore;
    evalState.metrics.lastRawThreshold = __tfThreshold;
    evalState.metrics.lastRawMargin = __tfScore - __tfThreshold;
    if (!Number.isFinite(Number(evalState.metrics.bestRawScore)) || __tfScore > Number(evalState.metrics.bestRawScore)) {
      evalState.metrics.bestRawScore = __tfScore;
      evalState.metrics.bestRawThreshold = __tfThreshold;
      evalState.metrics.bestRawMargin = __tfScore - __tfThreshold;
    }
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
  };

  if (evalState?.metrics) evalState.metrics.accepted = Number(evalState.metrics.accepted || 0) + 1;
  if (evalState?.cache) evalState.cache.set(key, result);
  return result;
}

function scoreOffer(result) {
  if (!result) return Infinity;
  const margin = Number(result.comfortMargin || 0);
  const closeness = Math.abs(margin - TARGET_COMFORT_MARGIN);
  const offer = Array.isArray(result.offer) ? result.offer : [];
  const assetCount = offer.length || 99;
  const playerCount = offer.filter((item) => item.type === "player").length;
  const pickCount = offer.filter((item) => item.type === "pick").length;
  const valueGap = Math.abs(Number(result.gap || 0));
  const noPlayerPenalty = playerCount ? 0 : 8;
  return closeness * 100 + assetCount * 0.28 + pickCount * 0.5 - playerCount * 0.28 + noPlayerPenalty + valueGap * 0.008;
}

async function tryBalanceWithAdditionalAssets({
  leagueData,
  selectedTeam,
  cpuTeam,
  selectedItems,
  startResult,
  additions,
  evalState,
}) {
  if (!startResult || !Array.isArray(additions) || !additions.length) return startResult;

  let best = startResult;
  let bestScore = scoreOffer(best);
  let currentItems = clonePackage(startResult.offer);
  const selectedValue = packageValue(selectedItems, leagueData);

  const maxBalanceRounds = Number(evalState?.profile?.maxBalanceRounds ?? MAX_BALANCE_ROUNDS);
  if (maxBalanceRounds <= 0) return startResult;

  for (let round = 0; round < maxBalanceRounds; round += 1) {
    if (currentItems.length >= MAX_SIDE_ITEMS) break;
    if (Number(evalState?.count || 0) >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState)) break;

    const used = new Set(currentItems.map(itemFamilyKey));
    const currentValue = packageValue(currentItems, leagueData);
    const currentGap = Math.abs(selectedValue - currentValue);
    const assetCandidates = additions
      .filter((asset) => !used.has(itemFamilyKey(asset)))
      .map((asset) => {
        const nextValue = currentValue + assetValue(asset, leagueData);
        const nextGap = Math.abs(selectedValue - nextValue);
        const playerBonus = asset.type === "player" ? -1.5 : 0;
        const pickPenalty = asset.type === "pick" ? 0.65 : 0;
        return { asset, roughScore: nextGap - currentGap + playerBonus + pickPenalty };
      })
      .sort((a, b) => a.roughScore - b.roughScore)
      .slice(0, 6);

    let bestAdditionResult = null;
    let bestAdditionScore = bestScore;

    for (const row of assetCandidates) {
      if (Number(evalState?.count || 0) >= getEvalLimit(evalState)) break;
      if (hasTeamTimeBudgetExpired(evalState)) break;
      const nextItems = [...currentItems, row.asset];
      const evaluated = evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: nextItems, evalState });
      if (evalState?.count && evalState.count % TRADE_FINDER_YIELD_EVERY_EVALUATIONS === 0) {
        await tfYieldToBrowser();
      }
      if (!evaluated) continue;
      const nextScore = scoreOffer(evaluated);

      if (nextScore < bestAdditionScore) {
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

async function findBestOfferForTeam({ leagueData, selectedTeam, cpuTeam, selectedItems, onProgress = null, searchState = null }) {
  const __tfTeamStart = tfDebugNow();
  const __tfTeamName = getTeamName(cpuTeam);
  const profile = getTradeFinderSearchProfile(selectedItems);
  const __tfCandidateStart = tfDebugNow();
  const { players, picks, candidates, playerPool, balancePlayers, balancePicks } = getCandidateAssets(cpuTeam, leagueData);
  const __tfCandidateMs = tfDebugNow() - __tfCandidateStart;
  if (!candidates.length) {
    tfDebugLog("team skipped - no candidates", { team: __tfTeamName, candidateMs: tfRoundMs(__tfCandidateMs) });
    return null;
  }

  const evalState = {
    cache: new Map(),
    count: 0,
    profile,
    teamStartedAt: __tfTeamStart,
    metrics: {
      candidateMs: __tfCandidateMs,
      basePackageMs: 0,
      impactMs: 0,
      finalValidationMs: 0,
      preRejected: 0,
      cacheHits: 0,
      cpuRejected: 0,
      comfortRejected: 0,
      finalRejected: 0,
      accepted: 0,
    },
  };
  const __tfBasePackageStart = tfDebugNow();
  const allBasePackages = buildBasePackages({ leagueData, selectedTeam, cpuTeam, selectedItems, players, picks, candidates, playerPool });
  const basePackages = allBasePackages.slice(0, Number(profile.maxBasePackagesPerTeam || MAX_BASE_PACKAGES_PER_TEAM));
  evalState.metrics.basePackageMs = tfDebugNow() - __tfBasePackageStart;
  const acceptedBases = [];
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < basePackages.length; i += 1) {
    if (evalState.count >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState)) break;
    const basePackage = basePackages[i];
    const evaluated = evaluateCpuOfferPackage({ leagueData, selectedTeam, cpuTeam, selectedItems, cpuItems: basePackage, evalState });

    if (evalState.count && evalState.count % TRADE_FINDER_YIELD_EVERY_EVALUATIONS === 0) {
      tfSafeProgress(onProgress, {
        phase: "evaluating",
        team: __tfTeamName,
        teamIndex: searchState?.teamIndex || 0,
        teamsToCheck: searchState?.teamsToCheck || 0,
        evaluationsForTeam: evalState.count,
        offersFound: searchState?.offersFound || 0,
      });
      await tfYieldToBrowser();
    }

    if (!evaluated) {
      if (shouldStopNoOfferSearch(evalState, acceptedBases)) break;
      continue;
    }

    acceptedBases.push(evaluated);
    const evaluatedScore = scoreOffer(evaluated);
    if (evaluatedScore < bestScore) {
      best = evaluated;
      bestScore = evaluatedScore;
    }

    if (i >= profile.baseEvalMinBeforeEarlyStop && acceptedBases.length >= profile.maxAcceptedBaseSeeds) break;
    if (i >= profile.baseEvalMinBeforeEarlyStop && bestScore <= profile.goodEnoughScore) break;
    if (profile.stopAfterFirstAccepted && i >= profile.baseEvalMinBeforeEarlyStop && acceptedBases.length >= 1) break;
  }

  if (!acceptedBases.length) return null;

  const balanceSeeds = acceptedBases.sort((a, b) => scoreOffer(a) - scoreOffer(b)).slice(0, profile.maxAcceptedBaseSeeds || MAX_ACCEPTED_BASE_SEEDS);

  for (const seed of balanceSeeds) {
    if (evalState.count >= getEvalLimit(evalState)) break;
    if (hasTeamTimeBudgetExpired(evalState)) break;
    if (profile.maxBalanceRounds <= 0) break;

    const playerBalanced = await tryBalanceWithAdditionalAssets({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      startResult: seed,
      additions: balancePlayers,
      evalState,
    });
    const pickBalanced = await tryBalanceWithAdditionalAssets({
      leagueData,
      selectedTeam,
      cpuTeam,
      selectedItems,
      startResult: playerBalanced || seed,
      additions: balancePicks,
      evalState,
    });
    const candidate = pickBalanced || playerBalanced || seed;
    const candidateScore = scoreOffer(candidate);

    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }

    if (bestScore <= profile.goodEnoughScore) break;
  }

  const __tfTeamMs = tfDebugNow() - __tfTeamStart;
  const __tfSummary = {
    team: __tfTeamName,
    totalMs: tfRoundMs(__tfTeamMs),
    candidateMs: tfRoundMs(evalState.metrics.candidateMs),
    basePackageMs: tfRoundMs(evalState.metrics.basePackageMs),
    impactMs: tfRoundMs(evalState.metrics.impactMs),
    finalValidationMs: tfRoundMs(evalState.metrics.finalValidationMs),
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
    bestRawScore: Number.isFinite(Number(evalState.metrics.bestRawScore)) ? tfRoundMs(evalState.metrics.bestRawScore) : null,
    bestRawMargin: Number.isFinite(Number(evalState.metrics.bestRawMargin)) ? tfRoundMs(evalState.metrics.bestRawMargin) : null,
    noOfferEarlyStop: evalState.metrics.noOfferEarlyStop || "",
    foundOffer: Boolean(best),
    bestScore: Number.isFinite(bestScore) ? tfRoundMs(bestScore) : null,
  };
  if (isTradeFinderDebugEnabled() && (__tfTeamMs >= TRADE_FINDER_SLOW_TEAM_MS || best)) {
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

export async function findComfortableTradeFinderOffers({ leagueData, selectedTeam, selectedItems = [], teams = [], onProgress = null } = {}) {
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
  const __tfSearchStart = tfDebugNow();
  const __tfTeamSummaries = [];

  tfDebugLog("search start", {
    selectedTeam: selectedName,
    selectedItems: tfItemsLabel(selectedItems),
    selectedValue: tfRoundMs(packageValue(selectedItems, leagueData)),
    teamsToCheck: checkTeams.length,
    searchProfile: getTradeFinderSearchProfile(selectedItems),
    maxEvaluationsPerTeam: getTradeFinderSearchProfile(selectedItems).maxEvaluationsPerTeam,
    theoreticalWorstCaseEvaluations: checkTeams.length * getTradeFinderSearchProfile(selectedItems).maxEvaluationsPerTeam,
    asyncChunked: true,
  });

  tfSafeProgress(onProgress, {
    phase: "start",
    team: "",
    teamIndex: 0,
    teamsToCheck: checkTeams.length,
    offersFound: 0,
    elapsedSec: 0,
  });

  for (let teamIndex = 0; teamIndex < checkTeams.length; teamIndex += 1) {
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
      },
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

  offers.sort((a, b) => scoreOffer(a) - scoreOffer(b) || String(getTeamName(a.team)).localeCompare(getTeamName(b.team)));

  const __tfTotalMs = tfDebugNow() - __tfSearchStart;
  const __tfTotalEvaluations = __tfTeamSummaries.reduce((sum, row) => sum + Number(row.evaluations || 0), 0);
  const __tfDebugResult = {
    totalMs: tfRoundMs(__tfTotalMs),
    totalSec: tfRoundMs(__tfTotalMs / 1000),
    offersFound: offers.length,
    teamsChecked: checkTeams.length,
    totalEvaluations: __tfTotalEvaluations,
    asyncChunked: true,
    adaptiveFast: true,
    noOfferFast: true,
    searchProfile: getTradeFinderSearchProfile(selectedItems).name,
    slowestTeams: __tfTeamSummaries.slice().sort((a, b) => b.ms - a.ms).slice(0, 8),
    teamSummaries: __tfTeamSummaries,
  };

  try {
    if (typeof window !== "undefined") window.__TF_LAST_DEBUG = __tfDebugResult;
  } catch {}

  tfDebugLog("search complete", __tfDebugResult);

  tfSafeProgress(onProgress, {
    phase: "complete",
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
    message: offers.length
      ? `Found ${offers.length} CPU-comfortable offer${offers.length === 1 ? "" : "s"}.`
      : "No CPU team found a Propose Trade-legal package it would comfortably accept.",
  };
}
