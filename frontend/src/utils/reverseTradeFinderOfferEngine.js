import {
  TRADE_FINDER_MAX_SIDE_ITEMS,
  assetValue,
  buildAssetBoard,
  buildTradeFinderCandidatePackages,
  getTeamName,
  itemFamilyKey,
  packageKey,
  packageValue,
  sortTradeFinderOfferItems,
  uniqueByFamilyKey,
} from "./tradeFinderPackageBuilder.js";
import { evaluateTradeTeamImpact, resetTradeFinderImpactSearchCaches } from "./tradeTeamImpact.js";
import {
  attachOffseasonTradeContext,
  buildOffseasonTradeEvaluationLeague,
  getOffseasonTradeContext,
  getTeamFromTradeLeague,
} from "./offseasonTradeContext.js";
import { getTradeFinderComfortFloorForPackage } from "./tradeFinderEvaluatorCache.js";
import {
  evaluateTradeFinancialLegality,
  sideSalary,
  validateTradeForExecution,
} from "./tradeExecution.js";
import { evaluateTradeRosterProjection } from "./rosterRules.js";
import {
  evaluateUserTradeFinancialLegality,
  validateUserTradeAssetPackage,
} from "./userTradeRules.js";
import {
  buildReverseRescueQueue,
  prioritizeReverseCandidateRows,
} from "./reverseTradeFinderCoverage.js";

const REVERSE_RAW_CANDIDATES = 640;
const REVERSE_MAX_CANDIDATES = 220;
const REVERSE_MAX_EXACT_EVALS = 48;
const REVERSE_RESCUE_EXACT_EVALS = 172;
const REVERSE_MAX_RESULTS = 5;
const REVERSE_EXPENSIVE_MARGIN = 8;
const SEARCH_YIELD_EVERY = 5;

function nowMs() {
  try {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isCancelled(signal) {
  return Boolean(signal?.aborted);
}

function safeProgress(onProgress, payload) {
  try {
    onProgress?.(payload);
  } catch {}
}

function isAccepted(evaluation = {}) {
  const decision = String(evaluation?.decision || "").toLowerCase();
  return Boolean(evaluation?.accepted || decision === "accept" || decision === "accepted");
}

function comfortMarginOf(evaluation = {}) {
  return Number(evaluation?.score || 0) - Number(evaluation?.teamImpact?.threshold || 0);
}

function rosterCountsOk({ controlledTeam, targetTeam, userItems, targetItems, inOffseason }) {
  const controlledProjection = evaluateTradeRosterProjection({
    team: controlledTeam,
    outgoingItems: userItems,
    incomingItems: targetItems,
    inOffseason: Boolean(inOffseason),
  });
  const targetProjection = evaluateTradeRosterProjection({
    team: targetTeam,
    outgoingItems: targetItems,
    incomingItems: userItems,
    inOffseason: Boolean(inOffseason),
  });
  return controlledProjection.ok && targetProjection.ok;
}

function financialsOk({ leagueData, controlledTeam, targetTeam, userItems, targetItems, userDrivenRules = false }) {
  if (userDrivenRules) {
    return Boolean(
      evaluateUserTradeFinancialLegality({
        team: controlledTeam,
        leagueData,
        outgoingItems: userItems,
        incomingItems: targetItems,
      })?.ok &&
        evaluateUserTradeFinancialLegality({
          team: targetTeam,
          leagueData,
          outgoingItems: targetItems,
          incomingItems: userItems,
        })?.ok
    );
  }
  const userOutgoing = sideSalary(userItems, leagueData);
  const userIncoming = sideSalary(targetItems, leagueData);
  const targetOutgoing = sideSalary(targetItems, leagueData);
  const targetIncoming = sideSalary(userItems, leagueData);
  return Boolean(
    evaluateTradeFinancialLegality({
      team: controlledTeam,
      leagueData,
      outgoingSalary: userOutgoing,
      incomingSalary: userIncoming,
    })?.ok &&
      evaluateTradeFinancialLegality({
        team: targetTeam,
        leagueData,
        outgoingSalary: targetOutgoing,
        incomingSalary: targetIncoming,
      })?.ok
  );
}

function evaluateCandidate({
  leagueData,
  evaluationLeagueData,
  controlledTeam,
  targetTeam,
  userItems,
  targetItems,
  mode,
}) {
  const evaluationControlledTeam =
    getTeamFromTradeLeague(evaluationLeagueData, getTeamName(controlledTeam)) || controlledTeam;
  const evaluationTargetTeam =
    getTeamFromTradeLeague(evaluationLeagueData, getTeamName(targetTeam)) || targetTeam;
  const isScan = mode === "scan";

  return evaluateTradeTeamImpact({
    leagueData: evaluationLeagueData,
    userTeam: evaluationControlledTeam,
    cpuTeam: evaluationTargetTeam,
    userTeamName: getTeamName(controlledTeam),
    cpuTeamName: getTeamName(targetTeam),
    userItems,
    cpuItems: targetItems,
    evaluationMode: "standard",
    cpuTradeRole: isScan ? "trade_finder" : "",
    cpuTradeContext: isScan
      ? {
          source: "reverse_trade_finder_scan_v1",
          searchPhase: "reverse_trade_finder_unified",
          tradeFinderFastScan: true,
        }
      : {
          source: "reverse_trade_finder_builder_exact_v1",
          searchPhase: "reverse_trade_finder_unified",
          tradeFinderExactConfirm: true,
        },
  });
}

function familySet(items = []) {
  return new Set((items || []).map(itemFamilyKey));
}

function isSubsetPackage(smaller = [], larger = []) {
  const small = familySet(smaller);
  const large = familySet(larger);
  if (!small.size || small.size >= large.size) return false;
  for (const key of small) if (!large.has(key)) return false;
  return true;
}

export function getReverseOfferAnchor(items = [], leagueData = null) {
  const players = (items || [])
    .filter((item) => item?.type === "player")
    .slice()
    .sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData));
  if (players.length) {
    const player = players[0]?.player || {};
    return {
      key: itemFamilyKey(players[0]),
      label: player?.name || player?.player || "Player package",
      type: "player",
    };
  }

  const firsts = (items || [])
    .filter((item) => item?.type === "pick" && Number(item?.pick?.round || 1) === 1)
    .slice()
    .sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData));
  if (firsts.length) {
    return { key: itemFamilyKey(firsts[0]), label: firsts[0]?.label || "First-round pick package", type: "first" };
  }

  const picks = (items || [])
    .filter((item) => item?.type === "pick")
    .slice()
    .sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData));
  if (picks.length) {
    return { key: itemFamilyKey(picks[0]), label: picks[0]?.label || "Draft-pick package", type: "pick" };
  }

  return { key: packageKey(items), label: "Package", type: "other" };
}

function weightedOverlap(a = [], b = [], leagueData = null) {
  const aByFamily = new Map((a || []).map((item) => [itemFamilyKey(item), Math.max(1, assetValue(item, leagueData))]));
  const bByFamily = new Map((b || []).map((item) => [itemFamilyKey(item), Math.max(1, assetValue(item, leagueData))]));
  let shared = 0;
  let smallerTotal = Math.min(
    [...aByFamily.values()].reduce((sum, value) => sum + value, 0),
    [...bByFamily.values()].reduce((sum, value) => sum + value, 0)
  );
  for (const [key, value] of aByFamily.entries()) {
    if (bByFamily.has(key)) shared += Math.min(value, bByFamily.get(key));
  }
  return smallerTotal > 0 ? shared / smallerTotal : 0;
}

function reverseOfferSort(a, b, comfortFloor) {
  const valueDiff = Number(a?.offerValue || 0) - Number(b?.offerValue || 0);
  if (Math.abs(valueDiff) > 0.35) return valueDiff;
  const itemDiff = Number(a?.offer?.length || 0) - Number(b?.offer?.length || 0);
  if (itemDiff) return itemDiff;
  const aMarginDistance = Math.abs(Number(a?.comfortMargin || 0) - Math.max(comfortFloor, 2.25));
  const bMarginDistance = Math.abs(Number(b?.comfortMargin || 0) - Math.max(comfortFloor, 2.25));
  return aMarginDistance - bMarginDistance;
}

export function selectDiverseReverseOffers(offers = [], leagueData = null, maxResults = REVERSE_MAX_RESULTS, comfortFloor = 1.5) {
  const exact = (offers || []).filter(Boolean).slice().sort((a, b) => reverseOfferSort(a, b, comfortFloor));
  const bestByAnchor = new Map();

  for (const offer of exact) {
    const anchor = offer.anchor || getReverseOfferAnchor(offer.offer || [], leagueData);
    const current = bestByAnchor.get(anchor.key);
    if (!current || reverseOfferSort(offer, current, comfortFloor) < 0) {
      bestByAnchor.set(anchor.key, { ...offer, anchor });
    }
  }

  const anchorWinners = [...bestByAnchor.values()].sort((a, b) => reverseOfferSort(a, b, comfortFloor));
  const pruned = anchorWinners.filter((offer, index, rows) =>
    !rows.some((other, otherIndex) =>
      otherIndex !== index &&
      other.anchor?.key === offer.anchor?.key &&
      isSubsetPackage(other.offer, offer.offer) &&
      Number(other.offerValue || 0) <= Number(offer.offerValue || 0)
    )
  );

  const selected = [];
  for (const offer of pruned) {
    if (selected.length >= Math.max(0, Number(maxResults || REVERSE_MAX_RESULTS))) break;
    const tooSimilar = selected.some((existing) => weightedOverlap(existing.offer, offer.offer, leagueData) >= 0.72);
    if (tooSimilar) continue;
    selected.push(offer);
  }
  return selected;
}

function candidateHeuristic(items, targetItems, leagueData) {
  const value = packageValue(items, leagueData);
  const targetValue = packageValue(targetItems, leagueData);
  const salaryGap = Math.abs(sideSalary(items, leagueData) - sideSalary(targetItems, leagueData)) / 1_000_000;
  return Math.abs(value - targetValue) + salaryGap * 0.35 + items.length * 0.55;
}

export function prioritizeReverseTradeFinderCandidates(
  candidates = [],
  targetItems = [],
  leagueData = null,
  maxCandidates = REVERSE_MAX_CANDIDATES
) {
  return prioritizeReverseCandidateRows({
    candidates,
    maxCandidates,
    packageKeyOf: packageKey,
    heuristicOf: (items) => candidateHeuristic(items, targetItems, leagueData),
  });
}

function makeResult({ leagueData, targetTeam, targetItems, userItems, evaluation, validation, comfortFloor }) {
  const sortedUserItems = sortTradeFinderOfferItems(userItems, leagueData);
  const sortedTargetItems = sortTradeFinderOfferItems(targetItems, leagueData);
  const offerValue = packageValue(sortedUserItems, leagueData);
  const targetValue = packageValue(sortedTargetItems, leagueData);
  const comfortMargin = comfortMarginOf(evaluation);
  const anchor = getReverseOfferAnchor(sortedUserItems, leagueData);
  return {
    team: targetTeam,
    offer: sortedUserItems,
    targetItems: sortedTargetItems,
    accepted: true,
    decision: "accept",
    evaluation,
    validation,
    comfortMargin,
    comfortFloor,
    offerValue,
    targetValue,
    gap: offerValue - targetValue,
    quality: comfortMargin > REVERSE_EXPENSIVE_MARGIN ? "Accepted Asking Price" : "Comfortable Asking Price",
    expensiveAskingPrice: comfortMargin > REVERSE_EXPENSIVE_MARGIN,
    reverseFinder: true,
    anchor,
    anchorKey: anchor.key,
    anchorLabel: anchor.label,
    finderEvaluationMode: "builder_exact",
    finderEvaluationPath: "reverse_trade_finder_builder_exact_v1",
    finderSearchPhase: "reverse_trade_finder_unified",
    approximateEvaluation: false,
  };
}

export async function runReverseTradeFinderSearch({
  leagueData,
  evaluationLeagueData = null,
  tradeContext = null,
  controlledTeam,
  targetTeam,
  targetItems = [],
  onProgress = null,
  signal = null,
  maxResults = REVERSE_MAX_RESULTS,
  userDrivenRules = false,
} = {}) {
  const startedAt = nowMs();
  if (!leagueData || !controlledTeam || !targetTeam || !Array.isArray(targetItems) || !targetItems.length) {
    return { offers: [], stopped: false, elapsedSec: 0, message: "Select at least one target asset before searching." };
  }

  const resolvedTradeContext = getOffseasonTradeContext(leagueData, tradeContext);
  const transactionLeagueData = attachOffseasonTradeContext(leagueData, resolvedTradeContext);
  const preparedEvaluation = evaluationLeagueData
    ? { leagueData: evaluationLeagueData, context: resolvedTradeContext }
    : buildOffseasonTradeEvaluationLeague(transactionLeagueData, resolvedTradeContext);
  leagueData = transactionLeagueData;
  evaluationLeagueData = preparedEvaluation.leagueData;
  tradeContext = resolvedTradeContext;

  const diagnostics = {
    version: "reverse_trade_finder_diagnostics_v2",
    controlledTeam: getTeamName(controlledTeam),
    targetTeam: getTeamName(targetTeam),
    targetAssetCount: targetItems.length,
    targetValue: round1(packageValue(targetItems, leagueData)),
    targetSalary: sideSalary(targetItems, leagueData),
    boardPlayers: 0,
    boardPicks: 0,
    rawGenerated: 0,
    duplicateCandidates: 0,
    emptyCandidates: 0,
    rosterRejected: 0,
    financialRejected: 0,
    legalCandidates: 0,
    candidatesSelectedForScan: 0,
    scanAccepted: 0,
    initialExactChecks: 0,
    rescueExactChecks: 0,
    exactAccepted: 0,
    exactNotAccepted: 0,
    belowComfortFloor: 0,
    expensiveAccepted: 0,
    finalValidationRejected: 0,
    finalValidationReasons: {},
  };

  const board = buildAssetBoard(controlledTeam, leagueData);
  diagnostics.boardPlayers = board?.players?.length || 0;
  diagnostics.boardPicks = board?.picks?.length || 0;
  const generated = buildTradeFinderCandidatePackages({
    board,
    leagueData,
    selectedItems: targetItems,
    selectedTeam: targetTeam,
    cpuTeam: controlledTeam,
    maxPackages: REVERSE_RAW_CANDIDATES,
    candidateOrder: "reverse_nearest",
  });
  diagnostics.rawGenerated = generated.length;

  const legalCandidates = [];
  const seen = new Set();
  for (const candidate of generated) {
    const cleaned = uniqueByFamilyKey(candidate || []).slice(0, TRADE_FINDER_MAX_SIDE_ITEMS);
    const key = packageKey(cleaned);
    if (!cleaned.length) {
      diagnostics.emptyCandidates += 1;
      continue;
    }
    if (seen.has(key)) {
      diagnostics.duplicateCandidates += 1;
      continue;
    }
    seen.add(key);
    if (!rosterCountsOk({ controlledTeam, targetTeam, userItems: cleaned, targetItems, inOffseason: tradeContext?.inOffseason })) {
      diagnostics.rosterRejected += 1;
      continue;
    }
    if (userDrivenRules) {
      const assetValidation = validateUserTradeAssetPackage({
        leagueData,
        teamName: getTeamName(controlledTeam),
        outgoingItems: cleaned,
        incomingItems: targetItems,
      });
      if (!assetValidation.ok) {
        diagnostics.financialRejected += 1;
        continue;
      }
    }
    if (!financialsOk({ leagueData, controlledTeam, targetTeam, userItems: cleaned, targetItems, userDrivenRules })) {
      diagnostics.financialRejected += 1;
      continue;
    }
    legalCandidates.push(cleaned);
  }
  diagnostics.legalCandidates = legalCandidates.length;
  const uniqueCandidates = prioritizeReverseTradeFinderCandidates(
    legalCandidates,
    targetItems,
    leagueData,
    REVERSE_MAX_CANDIDATES
  );
  diagnostics.candidatesSelectedForScan = uniqueCandidates.length;

  const comfortFloor = getTradeFinderComfortFloorForPackage(targetItems, leagueData);
  try {
    resetTradeFinderImpactSearchCaches({ keepPowerContext: true });
  } catch {}

  safeProgress(onProgress, {
    phase: "scan_start",
    candidateIndex: 0,
    candidatesToCheck: uniqueCandidates.length,
    exactCandidates: 0,
    offersFound: 0,
    elapsedSec: 0,
  });

  const scanAccepted = [];
  const heuristicFallback = uniqueCandidates
    .map((items) => ({ items, heuristic: candidateHeuristic(items, targetItems, leagueData) }))
    .sort((a, b) => a.heuristic - b.heuristic)
    .slice(0, 18);

  for (let index = 0; index < uniqueCandidates.length; index += 1) {
    if (isCancelled(signal)) break;
    const items = uniqueCandidates[index];
    const evaluation = evaluateCandidate({
      leagueData,
      evaluationLeagueData,
      controlledTeam,
      targetTeam,
      userItems: items,
      targetItems,
      mode: "scan",
    });
    const margin = comfortMarginOf(evaluation);
    if (isAccepted(evaluation) && margin >= Math.max(0, comfortFloor - 0.65)) {
      scanAccepted.push({ items, evaluation, margin });
    }
    safeProgress(onProgress, {
      phase: "scan_candidate",
      candidateIndex: index + 1,
      candidatesToCheck: uniqueCandidates.length,
      exactCandidates: 0,
      offersFound: scanAccepted.length,
      elapsedSec: round1((nowMs() - startedAt) / 1000),
    });
    if ((index + 1) % SEARCH_YIELD_EVERY === 0) await yieldToBrowser();
  }

  const shortlistMap = new Map();

  // Always exact-check every legal one-asset shell first. These are the cleanest
  // possible asking prices and must not be displaced by noisier multi-asset scan
  // candidates. This is what prevents a valid Player A offer from reappearing as
  // Player A + an unnecessary throw-in.
  const simpleCandidates = uniqueCandidates
    .filter((items) => items.length === 1)
    .map((items) => ({ items, heuristic: candidateHeuristic(items, targetItems, leagueData) }))
    .sort((a, b) => a.heuristic - b.heuristic);
  for (const row of simpleCandidates) {
    shortlistMap.set(packageKey(row.items), row.items);
    if (shortlistMap.size >= Math.min(REVERSE_MAX_EXACT_EVALS, 18)) break;
  }

  const scanSorted = scanAccepted
    .slice()
    .sort((a, b) => {
      const valueDiff = packageValue(a.items, leagueData) - packageValue(b.items, leagueData);
      if (Math.abs(valueDiff) > 0.35) return valueDiff;
      return Math.abs(a.margin - comfortFloor) - Math.abs(b.margin - comfortFloor);
    });

  // First reserve exact checks for distinct primary anchors. Without this pass,
  // dozens of tiny variations around one player could crowd out genuinely
  // different player- or pick-based packages before exact confirmation.
  const perAnchorCounts = new Map();
  for (const row of [...scanSorted, ...heuristicFallback]) {
    const anchor = getReverseOfferAnchor(row.items, leagueData);
    const count = Number(perAnchorCounts.get(anchor.key) || 0);
    if (count >= 2) continue;
    const key = packageKey(row.items);
    if (!shortlistMap.has(key)) {
      shortlistMap.set(key, row.items);
      perAnchorCounts.set(anchor.key, count + 1);
    }
    if (shortlistMap.size >= Math.min(REVERSE_MAX_EXACT_EVALS, 30)) break;
  }

  // Fill any remaining exact budget with the best overall candidates, still
  // deduped by exact package identity.
  for (const row of [...scanSorted, ...heuristicFallback]) {
    const key = packageKey(row.items);
    if (!shortlistMap.has(key)) shortlistMap.set(key, row.items);
    if (shortlistMap.size >= REVERSE_MAX_EXACT_EVALS) break;
  }
  const shortlist = [...shortlistMap.values()];

  safeProgress(onProgress, {
    phase: "exact_start",
    candidateIndex: 0,
    candidatesToCheck: uniqueCandidates.length,
    exactCandidates: shortlist.length,
    offersFound: 0,
    elapsedSec: round1((nowMs() - startedAt) / 1000),
  });

  diagnostics.scanAccepted = scanAccepted.length;
  const exactOffers = [];
  const exactCheckedKeys = new Set();

  const recordValidationReason = (validation = {}) => {
    const reason = String(validation?.staleCode || validation?.code || validation?.reason || "unknown_validation_failure")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown_validation_failure";
    diagnostics.finalValidationReasons[reason] = Number(diagnostics.finalValidationReasons[reason] || 0) + 1;
  };

  const exactCheckCandidate = (userItems, phase) => {
    const key = packageKey(userItems);
    if (!key || exactCheckedKeys.has(key)) return false;
    exactCheckedKeys.add(key);
    if (phase === "rescue") diagnostics.rescueExactChecks += 1;
    else diagnostics.initialExactChecks += 1;

    const evaluation = evaluateCandidate({
      leagueData,
      evaluationLeagueData,
      controlledTeam,
      targetTeam,
      userItems,
      targetItems,
      mode: "exact",
    });
    const margin = comfortMarginOf(evaluation);
    if (!isAccepted(evaluation)) {
      diagnostics.exactNotAccepted += 1;
      return false;
    }

    diagnostics.exactAccepted += 1;
    if (margin < comfortFloor) {
      diagnostics.belowComfortFloor += 1;
      return false;
    }
    if (margin > REVERSE_EXPENSIVE_MARGIN) diagnostics.expensiveAccepted += 1;

    const validation = validateTradeForExecution({
      leagueData,
      userTeam: controlledTeam,
      cpuTeam: targetTeam,
      userItems,
      cpuItems: targetItems,
      evaluation,
      userDrivenRules,
    });
    if (!validation?.ok) {
      diagnostics.finalValidationRejected += 1;
      recordValidationReason(validation);
      return false;
    }

    exactOffers.push(
      makeResult({ leagueData, targetTeam, targetItems, userItems, evaluation, validation, comfortFloor })
    );
    return true;
  };

  for (let index = 0; index < shortlist.length; index += 1) {
    if (isCancelled(signal)) break;
    exactCheckCandidate(shortlist[index], "initial");
    safeProgress(onProgress, {
      phase: "exact_candidate",
      candidateIndex: index + 1,
      candidatesToCheck: uniqueCandidates.length,
      exactCandidates: shortlist.length,
      offersFound: exactOffers.length,
      elapsedSec: round1((nowMs() - startedAt) / 1000),
    });
    if ((index + 1) % 3 === 0) await yieldToBrowser();
  }

  // Fast scan and exact evaluation deliberately use different fidelity. When
  // the first exact slice finds too few offers, exact-check a second ordered
  // slice rather than incorrectly declaring that no trade exists.
  const initialDiverseOffers = selectDiverseReverseOffers(exactOffers, leagueData, maxResults, comfortFloor);
  const rescueQueue = initialDiverseOffers.length >= maxResults
    ? []
    : buildReverseRescueQueue({
        candidates: uniqueCandidates,
        checkedKeys: exactCheckedKeys,
        maxCandidates: REVERSE_RESCUE_EXACT_EVALS,
        packageKeyOf: packageKey,
      });

  if (rescueQueue.length && !isCancelled(signal)) {
    safeProgress(onProgress, {
      phase: "rescue_start",
      candidateIndex: 0,
      candidatesToCheck: uniqueCandidates.length,
      exactCandidates: rescueQueue.length,
      offersFound: exactOffers.length,
      elapsedSec: round1((nowMs() - startedAt) / 1000),
    });

    for (let index = 0; index < rescueQueue.length; index += 1) {
      if (isCancelled(signal)) break;
      exactCheckCandidate(rescueQueue[index], "rescue");
      const diverseCount = selectDiverseReverseOffers(exactOffers, leagueData, maxResults, comfortFloor).length;
      safeProgress(onProgress, {
        phase: "rescue_candidate",
        candidateIndex: index + 1,
        candidatesToCheck: uniqueCandidates.length,
        exactCandidates: rescueQueue.length,
        offersFound: diverseCount,
        elapsedSec: round1((nowMs() - startedAt) / 1000),
      });
      if (diverseCount >= maxResults) break;
      if ((index + 1) % 3 === 0) await yieldToBrowser();
    }
  }

  const offers = selectDiverseReverseOffers(exactOffers, leagueData, maxResults, comfortFloor);
  const elapsedSec = round1((nowMs() - startedAt) / 1000);
  const stopped = isCancelled(signal);
  diagnostics.comfortFloor = comfortFloor;
  diagnostics.finalOffers = offers.length;
  diagnostics.elapsedSec = elapsedSec;
  diagnostics.stopped = stopped;

  let noOfferMessage = "No legal package from your team met the CPU's acceptance threshold.";
  if (!diagnostics.rawGenerated) {
    noOfferMessage = "Your team has no eligible player or pick package shapes available for this target.";
  } else if (!diagnostics.legalCandidates) {
    noOfferMessage = diagnostics.financialRejected > diagnostics.rosterRejected
      ? "Candidate packages were generated, but none passed both teams' salary-matching rules."
      : "Candidate packages were generated, but none passed the temporary roster and salary rules.";
  } else if (diagnostics.exactAccepted && diagnostics.finalValidationRejected >= diagnostics.exactAccepted) {
    noOfferMessage = "The CPU accepted candidate packages, but final ownership, salary, or roster validation rejected them. Run bmDiag.reverseTradeFinder() for the precise stage counts.";
  } else if (diagnostics.exactAccepted) {
    noOfferMessage = "The CPU accepted candidate packages, but none cleared the configured comfort floor after exact evaluation.";
  }

  safeProgress(onProgress, {
    phase: stopped ? "stopped" : "complete",
    candidateIndex: uniqueCandidates.length,
    candidatesToCheck: uniqueCandidates.length,
    exactCandidates: diagnostics.initialExactChecks + diagnostics.rescueExactChecks,
    offersFound: offers.length,
    elapsedSec,
  });

  try {
    console.groupCollapsed(
      `[ReverseTradeFinder][diagnostics] ${diagnostics.controlledTeam} → ${diagnostics.targetTeam} • ${offers.length} offer${offers.length === 1 ? "" : "s"}`
    );
    console.table([diagnostics]);
    if (Object.keys(diagnostics.finalValidationReasons).length) {
      console.table(diagnostics.finalValidationReasons);
    }
    console.groupEnd();
  } catch {}

  return {
    offers,
    stopped,
    elapsedSec,
    candidatesChecked: uniqueCandidates.length,
    exactCandidatesChecked: diagnostics.initialExactChecks + diagnostics.rescueExactChecks,
    comfortFloor,
    diagnostics,
    message: offers.length
      ? `Found ${offers.length} distinct accepted asking price${offers.length === 1 ? "" : "s"}.`
      : noOfferMessage,
  };

}

function canUseWorker() {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

export async function findComfortableReverseTradeFinderOffers(args = {}) {
  if (!canUseWorker()) return runReverseTradeFinderSearch(args);

  const resolvedTradeContext = getOffseasonTradeContext(args.leagueData, args.tradeContext);
  const transactionLeagueData = attachOffseasonTradeContext(args.leagueData, resolvedTradeContext);
  const preparedEvaluation = args.evaluationLeagueData
    ? { leagueData: args.evaluationLeagueData }
    : buildOffseasonTradeEvaluationLeague(transactionLeagueData, resolvedTradeContext);

  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../workers/reverseTradeFinderWorker.js", import.meta.url), { type: "module" });
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        try { worker.terminate(); } catch {}
        args.signal?.removeEventListener?.("abort", abortHandler);
        callback(value);
      };
      const abortHandler = () => finish(resolve, {
        offers: [],
        stopped: true,
        elapsedSec: 0,
        message: "Search stopped before completion.",
      });

      if (args.signal?.aborted) {
        abortHandler();
        return;
      }
      args.signal?.addEventListener?.("abort", abortHandler, { once: true });

      worker.onmessage = (event) => {
        const message = event?.data || {};
        if (message.type === "progress") {
          safeProgress(args.onProgress, message.payload || {});
          return;
        }
        if (message.type === "complete") {
          finish(resolve, message.result || { offers: [] });
          return;
        }
        if (message.type === "error") {
          const error = new Error(message.error?.message || "Reverse Trade Finder worker failed.");
          error.stack = message.error?.stack || error.stack;
          finish(reject, error);
        }
      };
      worker.onerror = (event) => finish(reject, new Error(event?.message || "Reverse Trade Finder worker failed."));
      worker.postMessage({
        type: "run_reverse",
        payload: {
          leagueData: transactionLeagueData,
          evaluationLeagueData: preparedEvaluation.leagueData,
          tradeContext: resolvedTradeContext,
          controlledTeam: args.controlledTeam,
          targetTeam: args.targetTeam,
          targetItems: args.targetItems,
          maxResults: Math.min(REVERSE_MAX_RESULTS, Math.max(0, Number(args.maxResults || REVERSE_MAX_RESULTS))),
          userDrivenRules: Boolean(args.userDrivenRules),
        },
      });
    });
  } catch (error) {
    if (args.signal?.aborted) {
      return { offers: [], stopped: true, elapsedSec: 0, message: "Search stopped before completion." };
    }
    console.warn("[ReverseTradeFinder] Worker search failed; falling back to the main thread.", error);
    return runReverseTradeFinderSearch({
      ...args,
      leagueData: transactionLeagueData,
      evaluationLeagueData: preparedEvaluation.leagueData,
      tradeContext: resolvedTradeContext,
    });
  }
}
