import {
  formatResolvedDraftPickLabel,
  isResolvedDraftPickAsset,
  normalizeTeamName,
} from "./draftPicks.js";
import { getDraftYear } from "./seasonContext.js";

const DRAFT_STATE_KEY = "bm_draft_state_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function getLiveDraftSeasonYear(leagueData) {
  const savedDraft = readLiveDraftState();
  const offseason = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const candidates = [
    savedDraft?.seasonYear,
    offseason?.draftYear,
    offseason?.seasonYear,
    leagueData?.draftState?.seasonYear,
    leagueData?.draftYear,
    leagueData?.currentDraftYear,
    getDraftYear(leagueData || {}),
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);
  return candidates.length ? Math.max(...candidates) : 2026;
}

export function readLiveDraftState() {
  return safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
}

export function readLiveDraftOrder(leagueData, seasonYear = getLiveDraftSeasonYear(leagueData)) {
  const savedDraft = readLiveDraftState();
  if (
    savedDraft &&
    Number(savedDraft?.seasonYear || seasonYear) === Number(seasonYear) &&
    Array.isArray(savedDraft?.draftOrder) &&
    savedDraft.draftOrder.length
  ) {
    return savedDraft.draftOrder;
  }

  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return direct;

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (leagueData?.draftState?.draftLotteryComplete && Array.isArray(lotteryOrder) && lotteryOrder.length) {
    return lotteryOrder;
  }

  const savedLottery = safeJSON(localStorage.getItem(DRAFT_LOTTERY_KEY), null);
  if (
    savedLottery &&
    Number(savedLottery?.seasonYear || seasonYear) === Number(seasonYear) &&
    savedLottery?.firstRoundRevealed &&
    savedLottery?.secondRoundRevealed &&
    Array.isArray(savedLottery?.result?.fullDraftOrder)
  ) {
    return savedLottery.result.fullDraftOrder;
  }

  return [];
}

export function getResolvedPickNumber(value = {}) {
  const n = Number(
    value?.pick ??
      value?.pickNumber ??
      value?.overallPick ??
      value?.draftPickNumber ??
      value?.resolvedPickNumber ??
      0
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getResolvedPickRound(value = {}) {
  const explicit = Number(value?.round ?? value?.roundNum ?? value?.pickRound ?? 0);
  if (explicit === 1 || explicit === 2) return explicit;
  const pickNumber = getResolvedPickNumber(value);
  return pickNumber > 30 ? 2 : 1;
}

function originalTeamOf(value = {}) {
  return (
    value?.originalTeamName ||
    value?.originalPickTeamName ||
    value?.naturalLotteryTeamName ||
    value?.originalTeam ||
    value?.teamName ||
    ""
  );
}

export function resolvedPickIdentityMatches(a = {}, b = {}) {
  const aPick = getResolvedPickNumber(a);
  const bPick = getResolvedPickNumber(b);
  if (!aPick || !bPick || aPick !== bPick) return false;
  if (getResolvedPickRound(a) !== getResolvedPickRound(b)) return false;

  const aOriginal = normalizeTeamName(originalTeamOf(a));
  const bOriginal = normalizeTeamName(originalTeamOf(b));
  return !aOriginal || !bOriginal || aOriginal === bOriginal;
}

export function getLiveDraftProgressSignature(leagueData) {
  const seasonYear = getLiveDraftSeasonYear(leagueData);
  const state = readLiveDraftState();
  const draftedCount = Array.isArray(state?.draftedPicks) ? state.draftedPicks.length : 0;
  const currentPickIndex = Number(state?.currentPickIndex || 0);
  return `${seasonYear}:${state?.completed ? 1 : 0}:${currentPickIndex}:${draftedCount}`;
}

export function isDraftOrderRowTradeable(row, index, leagueData, seasonYear = getLiveDraftSeasonYear(leagueData)) {
  const state = readLiveDraftState();
  if (!state || Number(state?.seasonYear || seasonYear) !== Number(seasonYear)) return true;
  if (state.completed) return false;

  const drafted = Array.isArray(state.draftedPicks) ? state.draftedPicks : [];
  if (drafted.some((picked) => resolvedPickIdentityMatches(picked, row))) return false;

  const currentPickIndex = Math.max(0, Number(state.currentPickIndex || 0));
  return Number(index) >= currentPickIndex;
}

export function filterTradeableLiveDraftRows(rows = [], leagueData, seasonYear = getLiveDraftSeasonYear(leagueData)) {
  return (Array.isArray(rows) ? rows : []).filter((row, index) =>
    isDraftOrderRowTradeable(row, index, leagueData, seasonYear)
  );
}

export function isResolvedPickConsumed(pick = {}, leagueData) {
  if (!isResolvedDraftPickAsset(pick)) return false;

  const seasonYear = Number(pick?.year || pick?.seasonYear || getLiveDraftSeasonYear(leagueData));
  const liveSeasonYear = getLiveDraftSeasonYear(leagueData);
  if (Number(seasonYear) !== Number(liveSeasonYear)) return false;

  const state = readLiveDraftState();
  if (!state || Number(state?.seasonYear || liveSeasonYear) !== Number(liveSeasonYear)) return false;
  if (state.completed) return true;

  const drafted = Array.isArray(state.draftedPicks) ? state.draftedPicks : [];
  if (drafted.some((row) => resolvedPickIdentityMatches(row, pick))) return true;

  const order = readLiveDraftOrder(leagueData, liveSeasonYear);
  const index = order.findIndex((row) => resolvedPickIdentityMatches(row, pick));
  return index >= 0 && Number(state.currentPickIndex || 0) > index;
}

function tradeItemPick(item = {}) {
  return item?.type === "pick" ? item?.pick || item : null;
}

function consumedItemLabel(item = {}) {
  const pick = tradeItemPick(item);
  if (!pick) return "Draft pick";
  try {
    return formatResolvedDraftPickLabel(pick);
  } catch {
    const number = getResolvedPickNumber(pick);
    return `${pick?.year || "Current"} Pick${number ? ` #${number}` : ""}`;
  }
}

export function sanitizeBuilderForLiveDraft(builder, leagueData) {
  const source = builder && typeof builder === "object" ? builder : {};
  const removed = [];

  const cleanSide = (items = []) =>
    (Array.isArray(items) ? items : []).filter((item) => {
      const pick = tradeItemPick(item);
      if (!pick || !isResolvedPickConsumed(pick, leagueData)) return true;
      removed.push(consumedItemLabel(item));
      return false;
    });

  const userItems = cleanSide(source.userItems);
  const cpuItems = cleanSide(source.cpuItems);
  const changed = userItems.length !== (source.userItems || []).length || cpuItems.length !== (source.cpuItems || []).length;

  return {
    changed,
    removed: [...new Set(removed)],
    builder: changed
      ? {
          ...source,
          userItems,
          cpuItems,
          source: source.source === "tradeFinder" ? "tradeBuilder" : source.source,
          returnToTradeFinder: false,
          tradeFinderEvaluation: null,
          tradeFinderOfferMeta: null,
          updatedAt: Date.now(),
        }
      : source,
  };
}
