import { evaluateTradeTeamImpact } from "./tradeTeamImpact.js";
import {
  getOffseasonTradeContext,
  getTeamFromTradeLeague,
} from "./offseasonTradeContext.js";
import {
  evaluateTradeFinancialLegality,
  sideSalary,
  validateTradeForExecution,
} from "./tradeExecution.js";
import {
  packageKey,
  packageValue,
  sortTradeFinderOfferItems,
  getTeamName,
} from "./tradeFinderPackageBuilder.js";
import { evaluateTradeRosterProjection } from "./rosterRules.js";
import { evaluateUserTradeFinancialLegality } from "./userTradeRules.js";

import { economyOvrForPlayer, TRADE_TIER } from "./nativeDeflatedTradeScale.js";
export const TRADE_FINDER_COMFORT_FLOOR = 1.5;

export function getTradeFinderComfortFloorForPackage(selectedItems = [], leagueData = null) {
  const items = Array.isArray(selectedItems) ? selectedItems : [];
  const players = items.filter((item) => item?.type === "player");
  const picks = items.filter((item) => item?.type === "pick");
  const sortedEconomyOvrs = players
    .map((item) => economyOvrForPlayer(item.player || {}))
    .sort((a, b) => b - a);
  const visibleOvrs = players
    .map((item) => Number(item.player?.overall || item.player?.ovr || 0))
    .sort((a, b) => b - a);
  const bestOvr = sortedEconomyOvrs[0] || 0;
  const secondOvr = sortedEconomyOvrs[1] || 0;
  const bestVisible = visibleOvrs[0] || 0;
  const selectedSalary = items.reduce((sum, item) => sum + Number(item.salary || item.player?.contract?.salaryByYear?.[0] || 0), 0);
  const pickValue = picks.reduce((sum, item) => sum + packageValue([item], leagueData), 0);
  const cheapUsefulSingle =
    players.length === 1 &&
    picks.length === 0 &&
    bestVisible >= TRADE_TIER.ROTATION &&
    bestVisible <= TRADE_TIER.STARTER + 2 &&
    selectedSalary <= 12_000_000;

  // Patch 32: revive normal-asset Trade Finder searches on the deflated scale.
  // Stars/franchise assets remain strict; 70-78 visible players no longer search
  // like old bench filler or old superstar packages.
  if (bestOvr >= 92 || pickValue >= 55 || (bestOvr >= 88 && pickValue >= 25)) return 1.5;
  if (bestOvr >= 88) return 1.30;
  if (bestOvr >= 84 || pickValue >= 30) return 1.10;
  if (bestOvr >= 80 || (bestOvr >= 78 && secondOvr >= 75) || pickValue >= 22) return 0.85;
  if (cheapUsefulSingle) return 0.25;
  if (bestOvr >= 75 || pickValue >= 14) return 0.55;
  if (!players.length && picks.length) return pickValue >= 30 ? 0.95 : 0.70;
  return 0.45;
}



function nowMs() {
  try {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
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


function rosterCountsOk({ selectedTeam, cpuTeam, selectedItems = [], cpuItems = [], tradeContext = null } = {}) {
  const selectedProjection = evaluateTradeRosterProjection({
    team: selectedTeam,
    outgoingItems: selectedItems,
    incomingItems: cpuItems,
    inOffseason: Boolean(tradeContext?.inOffseason),
  });
  const cpuProjection = evaluateTradeRosterProjection({
    team: cpuTeam,
    outgoingItems: cpuItems,
    incomingItems: selectedItems,
    inOffseason: Boolean(tradeContext?.inOffseason),
  });

  // Unequal player packages may temporarily leave a team below 14. That is a
  // simulation-readiness issue, not a trade-generation blocker. Only the hard
  // temporary standard-roster transaction ceiling blocks the package here.
  return selectedProjection.ok && cpuProjection.ok;
}
export function makeTradeFinderEvalContext({
  leagueData,
  evaluationLeagueData = null,
  tradeContext = null,
  selectedTeam,
  selectedItems = [],
  comfortFloor = null,
  userDrivenRules = false,
} = {}) {
  const hasExplicitComfortFloor = comfortFloor !== null && comfortFloor !== undefined && Number.isFinite(Number(comfortFloor));
  const resolvedComfortFloor = hasExplicitComfortFloor
    ? Number(comfortFloor)
    : getTradeFinderComfortFloorForPackage(selectedItems, leagueData);
  const resolvedTradeContext = getOffseasonTradeContext(leagueData, tradeContext);
  const resolvedEvaluationLeague = evaluationLeagueData || leagueData;
  const evaluationSelectedTeam = getTeamFromTradeLeague(
    resolvedEvaluationLeague,
    getTeamName(selectedTeam)
  ) || selectedTeam;
  return {
    leagueData,
    evaluationLeagueData: resolvedEvaluationLeague,
    tradeContext: resolvedTradeContext,
    selectedTeam,
    evaluationSelectedTeam,
    selectedItems,
    userDrivenRules: Boolean(userDrivenRules),
    comfortFloor: resolvedComfortFloor,
    useUltraFastExact: (() => {
      const items = Array.isArray(selectedItems) ? selectedItems : [];
      const bestOvr = items.filter((item) => item?.type === "player").reduce((max, item) => Math.max(max, economyOvrForPlayer(item.player || {})), 0);
      const value = packageValue(items, leagueData);
      return bestOvr >= 92 || value >= 90;
    })(),
    exactCache: new Map(),
    scanCache: new Map(),
    financialCache: new Map(),
    metrics: {
      exactEvaluations: 0,
      scanEvaluations: 0,
      exactCacheHits: 0,
      scanCacheHits: 0,
      financialCacheHits: 0,
      financialRejected: 0,
      cpuRejected: 0,
      comfortRejected: 0,
      finalRejected: 0,
      accepted: 0,
      impactMs: 0,
      validationMs: 0,
      financialMs: 0,
    },
  };
}

export function financialOk({ context, cpuTeam, cpuItems }) {
  const { leagueData, selectedTeam, selectedItems } = context || {};
  if (!Array.isArray(cpuItems) || !cpuItems.length) return false;
  if (!Array.isArray(selectedItems) || !selectedItems.length) return false;

  if (!rosterCountsOk({
    selectedTeam,
    cpuTeam,
    selectedItems,
    cpuItems,
    tradeContext: context?.tradeContext,
  })) {
    context.metrics.financialRejected += 1;
    return false;
  }

  const key = `${getTeamName(cpuTeam)}::${packageKey(cpuItems)}`;
  if (context?.financialCache?.has(key)) {
    context.metrics.financialCacheHits += 1;
    return context.financialCache.get(key);
  }

  const startedAt = nowMs();
  const selectedFinancial = context?.userDrivenRules
    ? evaluateUserTradeFinancialLegality({
        team: selectedTeam,
        leagueData,
        outgoingItems: selectedItems,
        incomingItems: cpuItems,
      })
    : evaluateTradeFinancialLegality({
        team: selectedTeam,
        leagueData,
        outgoingSalary: sideSalary(selectedItems, leagueData),
        incomingSalary: sideSalary(cpuItems, leagueData),
      });
  if (!selectedFinancial.ok) {
    context.metrics.financialMs += nowMs() - startedAt;
    context.financialCache.set(key, false);
    return false;
  }

  const cpuFinancial = context?.userDrivenRules
    ? evaluateUserTradeFinancialLegality({
        team: cpuTeam,
        leagueData,
        outgoingItems: cpuItems,
        incomingItems: selectedItems,
      })
    : evaluateTradeFinancialLegality({
        team: cpuTeam,
        leagueData,
        outgoingSalary: sideSalary(cpuItems, leagueData),
        incomingSalary: sideSalary(selectedItems, leagueData),
      });
  const ok = Boolean(cpuFinancial.ok);
  context.metrics.financialMs += nowMs() - startedAt;
  context.financialCache.set(key, ok);
  return ok;
}

function makeResult({ context, cpuTeam, cpuItems, evaluation, finalValidation, mode }) {
  const { leagueData, selectedItems } = context || {};
  const sortedItems = sortTradeFinderOfferItems(cpuItems, leagueData);
  const offerValue = packageValue(sortedItems, leagueData);
  const targetValue = packageValue(selectedItems, leagueData);
  const comfortMargin = getComfortMargin(evaluation);
  return {
    team: cpuTeam,
    offer: sortedItems,
    accepted: true,
    decision: "accept",
    evaluation,
    validation: finalValidation || { ok: true },
    comfortMargin,
    offerValue,
    targetValue,
    gap: offerValue - targetValue,
    quality: comfortMargin <= 8 ? "Comfort Offer" : "CPU-Lean Offer",
    finderEvaluationMode: mode === "scan" ? "fast_scan" : "trade_finder_exact_confirm",
    finderEvaluationPath: mode === "scan" ? "fast_scan:v12" : "builder_exact:v12",
    finderSearchPhase: "v12_builder_exact_anchor_optimizer",
    approximateEvaluation: false,
  };
}

export function evaluateCpuPackage({ context, cpuTeam, cpuItems, mode = "exact", requireFinalValidation = true }) {
  const {
    leagueData,
    evaluationLeagueData,
    evaluationSelectedTeam,
    selectedTeam,
    selectedItems,
    comfortFloor,
  } = context || {};
  if (!Array.isArray(cpuItems) || !cpuItems.length || cpuItems.length > 8) return null;

  if (!financialOk({ context, cpuTeam, cpuItems })) {
    context.metrics.financialRejected += 1;
    return null;
  }

  const cache = mode === "scan" ? context.scanCache : context.exactCache;
  const cacheKey = `${mode || "exact"}::${getTeamName(cpuTeam)}::${packageKey(cpuItems)}`;
  if (cache.has(cacheKey)) {
    if (mode === "scan") context.metrics.scanCacheHits += 1;
    else context.metrics.exactCacheHits += 1;
    return cache.get(cacheKey);
  }

  const startedAt = nowMs();
  const isScan = mode === "scan";
  const isBuilderExact = mode === "builder_exact" || mode === "builder" || mode === "propose_exact";
  const isTradeFinderExact = !isBuilderExact && (mode === "tf_exact" || mode === "exact");
  const evaluationCpuTeam = getTeamFromTradeLeague(
    evaluationLeagueData || leagueData,
    getTeamName(cpuTeam)
  ) || cpuTeam;
  const evaluation = evaluateTradeTeamImpact({
    leagueData: evaluationLeagueData || leagueData,
    userTeam: evaluationSelectedTeam || selectedTeam,
    cpuTeam: evaluationCpuTeam,
    userTeamName: getTeamName(selectedTeam),
    cpuTeamName: getTeamName(cpuTeam),
    userItems: selectedItems,
    cpuItems,
    evaluationMode: "standard",
    // V12: final Trade Finder results use the same builder/exact CPU logic as
    // the manual Propose Trade evaluator. Scan mode may still use Trade Finder
    // context for rough probes, but displayed offers must pass builder_exact.
    cpuTradeRole: isScan || isTradeFinderExact ? "trade_finder" : "",
    cpuTradeContext: isScan
      ? {
          source: "trade_finder_offer_engine_v12_scan",
          searchPhase: "v12_builder_exact_anchor_optimizer",
          tradeFinderFastScan: true,
        }
      : isTradeFinderExact
        ? {
            source: "trade_finder_offer_engine_v12_fast_ftr_confirm",
            searchPhase: "v12_builder_exact_anchor_optimizer",
            tradeFinderFastFtrConfirm: true,
          }
        : {
            source: "trade_finder_offer_engine_v12_builder_exact_confirm",
            searchPhase: "v12_builder_exact_anchor_optimizer",
            tradeFinderExactConfirm: true,
          },
  });
  context.metrics.impactMs += nowMs() - startedAt;
  if (mode === "scan") context.metrics.scanEvaluations += 1;
  else context.metrics.exactEvaluations += 1;

  if (!hasAcceptedEvaluation(evaluation)) {
    context.metrics.cpuRejected += 1;
    cache.set(cacheKey, null);
    return null;
  }

  const comfortMargin = getComfortMargin(evaluation);
  if (comfortMargin < comfortFloor) {
    context.metrics.comfortRejected += 1;
    cache.set(cacheKey, null);
    return null;
  }

  let finalValidation = { ok: true };
  if (requireFinalValidation) {
    const validationStartedAt = nowMs();
    finalValidation = validateTradeForExecution({
      leagueData,
      userTeam: selectedTeam,
      cpuTeam,
      userItems: selectedItems,
      cpuItems,
      evaluation,
      userDrivenRules: Boolean(context?.userDrivenRules),
    });
    context.metrics.validationMs += nowMs() - validationStartedAt;
    if (!finalValidation.ok) {
      context.metrics.finalRejected += 1;
      cache.set(cacheKey, null);
      return null;
    }
  }

  const result = makeResult({ context, cpuTeam, cpuItems, evaluation, finalValidation, mode });
  context.metrics.accepted += 1;
  cache.set(cacheKey, result);
  return result;
}

export function exactConfirmResult({ context, scanResult = null, cpuTeam = null, cpuItems = null }) {
  const team = cpuTeam || scanResult?.team;
  const items = cpuItems || scanResult?.offer || [];
  if (!team || !items.length) return null;
  return evaluateCpuPackage({ context, cpuTeam: team, cpuItems: items, mode: "exact", requireFinalValidation: true });
}

export function compareOfferStrength(a = null, b = null) {
  if (!a) return -1;
  if (!b) return 1;
  const aValue = Number(a.offerValue ?? 0);
  const bValue = Number(b.offerValue ?? 0);
  if (Math.abs(aValue - bValue) > 0.35) return aValue > bValue ? 1 : -1;
  const aMargin = Number(a.comfortMargin ?? 0);
  const bMargin = Number(b.comfortMargin ?? 0);
  // If values are almost tied, prefer the one closer to the acceptance floor.
  return Math.abs(aMargin - TRADE_FINDER_COMFORT_FLOOR) < Math.abs(bMargin - TRADE_FINDER_COMFORT_FLOOR) ? 1 : -1;
}
