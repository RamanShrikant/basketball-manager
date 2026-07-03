import {
  TRADE_FINDER_MAX_SIDE_ITEMS,
  assetValue,
  buildAssetBoard,
  getAllTeamsFromLeagueData,
  getTeamName,
  itemFamilyKey,
  packageKey,
  packageValue,
  sameTeamName,
  sortTradeFinderOfferItems,
  uniqueByFamilyKey,
} from "./tradeFinderPackageBuilder.js";
import { resetTradeFinderImpactSearchCaches } from "./tradeTeamImpact.js";

import {
  TRADE_FINDER_COMFORT_FLOOR,
  compareOfferStrength,
  evaluateCpuPackage,
  financialOk,
  makeTradeFinderEvalContext,
} from "./tradeFinderEvaluatorCache.js";

export { sortTradeFinderOfferItems } from "./tradeFinderPackageBuilder.js";

const TRADE_FINDER_DEBUG_KEY = "bm_trade_finder_debug_v1";
const SEARCH_YIELD_EVERY_TEAMS = 1;

// V12 is intentionally accuracy/logic-first. It does not brute-force every
// possible asset combo. It walks a deterministic salary-aware player ladder:
// best anchor -> best legal player core -> exact accept -> add support picks.
const MAX_ANCHORS_BY_BUCKET = {
  star: 13,
  strong: 12,
  normal: 13,
  cheap: 15,
  pickOnly: 10,
  small: 12,
};
const MAX_CORE_TRIES_PER_ANCHOR = 12;
const MAX_TOTAL_CORE_EVALS_PER_TEAM = 72;
const MAX_SUPPORT_EVALS_PER_TEAM = 14;
const MAX_SUPPORT_ITEMS_BY_BUCKET = {
  star: 5,
  strong: 4,
  normal: 3,
  cheap: 2,
  pickOnly: 3,
  small: 2,
};
const COMFORT_TARGET_BUFFER = 0.65;
const BUILDER_EXACT_MODE = "builder_exact";

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

function isDebugEnabled() {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        (window.__TF_DEBUG || window.__debugTradeFinder || localStorage.getItem(TRADE_FINDER_DEBUG_KEY) === "1")
    );
  } catch {
    return false;
  }
}

function debugLog(label, payload = null) {
  if (!isDebugEnabled()) return;
  if (payload === null || payload === undefined) console.log(`[TF DEBUG] ${label}`);
  else console.log(`[TF DEBUG] ${label}`, payload);
}

function isCancelled(signal) {
  return Boolean(signal?.aborted);
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function safeProgress(onProgress, payload = {}) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress(payload);
  } catch {}
}

function playerOvrOf(item = {}) {
  return Number(item?.player?.overall || item?.player?.ovr || 0);
}

function playerPotOf(item = {}) {
  return Number(item?.player?.potential || item?.player?.pot || item?.player?.overall || item?.player?.ovr || 0);
}

function playerAgeOf(item = {}) {
  return Number(item?.player?.age || 27);
}

function playerSalaryOf(item = {}) {
  return Number(item?.salary || item?.player?.contract?.salaryByYear?.[0] || 0);
}

function packageSalary(items = []) {
  return (items || []).reduce((sum, item) => sum + (item?.type === "player" ? playerSalaryOf(item) : 0), 0);
}

function cleanPackage(items = []) {
  return uniqueByFamilyKey((items || []).filter(Boolean)).slice(0, TRADE_FINDER_MAX_SIDE_ITEMS);
}

function selectedProfile(context = {}) {
  const items = Array.isArray(context.selectedItems) ? context.selectedItems : [];
  const players = items.filter((item) => item?.type === "player");
  const picks = items.filter((item) => item?.type === "pick");
  const sortedOvrs = players.map(playerOvrOf).sort((a, b) => b - a);
  const bestOvr = sortedOvrs[0] || 0;
  const secondOvr = sortedOvrs[1] || 0;
  const bestPot = players.reduce((max, item) => Math.max(max, playerPotOf(item)), 0);
  const salary = packageSalary(items);
  const totalValue = packageValue(items, context.leagueData);
  const pickValue = picks.reduce((sum, item) => sum + assetValue(item, context.leagueData), 0);
  const cheapUsefulSingle = players.length === 1 && picks.length === 0 && bestOvr >= 73 && bestOvr <= 78 && salary <= 9_000_000;
  const pickOnly = players.length === 0 && picks.length > 0;

  // Use headline strength instead of raw total package value. Two rotation players
  // can have a big internal value, but they should not search like a franchise
  // superstar. Picks can still push a package upward.
  const star = bestOvr >= 88 || pickValue >= 55 || (bestOvr >= 84 && pickValue >= 25);
  const strong = !star && (bestOvr >= 82 || pickValue >= 28 || (bestOvr >= 78 && secondOvr >= 75));
  const normal = !star && !strong && (bestOvr >= 74 || pickValue >= 14 || totalValue >= 28);
  const bucket = star ? "star" : strong ? "strong" : cheapUsefulSingle ? "cheap" : pickOnly ? "pickOnly" : normal ? "normal" : "small";
  return {
    items,
    players,
    picks,
    bestOvr,
    secondOvr,
    bestPot,
    salary,
    totalValue,
    pickValue,
    cheapUsefulSingle,
    pickOnly,
    star,
    strong,
    normal,
    bucket,
  };
}

function supportPickLimit(profile = {}) {
  return MAX_SUPPORT_ITEMS_BY_BUCKET[profile.bucket] ?? 2;
}

function maxAnchors(profile = {}) {
  return MAX_ANCHORS_BY_BUCKET[profile.bucket] ?? 12;
}

function isSwapPickItem(item = {}) {
  const pick = item?.pick || {};
  const rule = item?.tradeRule || pick.tradeRule || {};
  const text = `${item?.label || ""} ${pick?.label || ""} ${pick?.assetType || ""} ${pick?.type || ""}`.toLowerCase();
  return Boolean(rule.swapId || text.includes("swap"));
}

function pickRoundOf(item = {}) {
  const raw = item?.pick?.round ?? item?.round ?? 1;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const text = String(raw || item?.label || "").toLowerCase();
  if (text.includes("2")) return 2;
  return 1;
}

function makeOfferDebugSummary(offer = null) {
  if (!offer) return null;
  return {
    team: getTeamName(offer.team),
    assets: (offer.offer || []).length,
    value: round1(offer.offerValue),
    gap: round1(offer.gap),
    comfortMargin: round1(offer.comfortMargin),
    items: (offer.offer || []).map((item) => item.label || item.player?.name || item.pick?.label || item.protection || item.type),
  };
}

function withSearchStats(offer, stats = {}) {
  if (!offer) return null;
  return { ...offer, searchStats: { ...(offer.searchStats || {}), ...stats } };
}

function playerTradeScore(item = {}, leagueData = null) {
  const ovr = playerOvrOf(item);
  const pot = playerPotOf(item);
  const age = playerAgeOf(item);
  const salaryM = playerSalaryOf(item) / 1_000_000;
  const value = assetValue(item, leagueData);
  const ageBonus = age <= 23 ? 3.0 : age <= 26 ? 2.2 : age <= 29 ? 1.1 : age <= 32 ? 0 : -1.5;
  const contractDrag = salaryM >= 45 && ovr < 88 ? 4 : salaryM >= 35 && ovr < 84 ? 2.5 : 0;
  return ovr * 4.2 + pot * 0.7 + value * 2.0 + ageBonus - contractDrag;
}

function playerCoreScore(items = [], leagueData = null, profile = {}) {
  const players = (items || []).filter((item) => item?.type === "player");
  const sorted = players.slice().sort((a, b) => playerTradeScore(b, leagueData) - playerTradeScore(a, leagueData));
  const best = sorted[0] || null;
  const bestOvr = best ? playerOvrOf(best) : 0;
  const value = packageValue(players, leagueData);
  const salary = packageSalary(players) / 1_000_000;
  const salaryTarget = Number(profile.salary || 0) / 1_000_000;
  const salaryGap = salaryTarget > 0 ? Math.abs(salary - salaryTarget) : Math.max(0, salary - 8);
  const playerQuality = sorted.reduce((sum, item, index) => sum + playerTradeScore(item, leagueData) * (index === 0 ? 1 : index === 1 ? 0.58 : 0.36), 0);
  return playerQuality + value * 1.8 + bestOvr * 5 - salaryGap * 1.0 - Math.max(0, players.length - 4) * 8;
}

function meaningfulSupportMinOvr(profile = {}) {
  if (profile.star) return 73;
  if (profile.strong) return Math.max(74, Number(profile.bestOvr || 0) - 8);
  if (profile.normal) return Math.max(68, Number(profile.bestOvr || 0) - 9);
  if (profile.cheapUsefulSingle) return Math.max(58, Number(profile.bestOvr || 0) - 10);
  return 64;
}

function ovrVector(items = []) {
  const values = (items || []).filter((item) => item?.type === "player").map(playerOvrOf).sort((a, b) => b - a);
  while (values.length < 5) values.push(0);
  return values;
}

function compareOvrVectors(aItems = [], bItems = []) {
  const a = ovrVector(aItems);
  const b = ovrVector(bItems);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = Number(b[i] || 0) - Number(a[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function comparePlayerOvrLadder(aItems = [], bItems = []) {
  const a = ovrVector(aItems);
  const b = ovrVector(bItems);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = Number(a[i] || 0) - Number(b[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function pickCount(items = []) {
  return (items || []).filter((item) => item?.type === "pick").length;
}

function playerIdentityVector(items = []) {
  return (items || [])
    .filter((item) => item?.type === "player")
    .map((item) => String(item?.player?.id || item?.player?.name || item?.label || ""))
    .sort()
    .join("|");
}

function unnecessaryLowFillerCount({ context, cpuTeam, items = [], profile = {} }) {
  const minOvr = meaningfulSupportMinOvr(profile);
  let count = 0;
  for (const item of items || []) {
    if (item?.type !== "player") continue;
    if (playerOvrOf(item) >= minOvr) continue;
    if (items.length <= 1) continue;
    const without = items.filter((other) => itemFamilyKey(other) !== itemFamilyKey(item));
    if (without.length && financialOk({ context, cpuTeam, cpuItems: without })) count += 1;
  }
  return count;
}

function anchorMaxOvr(profile = {}) {
  if (profile.star) return 99;
  if (profile.strong) return Math.min(99, Math.max(88, profile.bestOvr + 7));
  if (profile.normal) {
    const pickBoost = profile.pickValue >= 24 ? 10 : profile.pickValue >= 14 ? 8 : 5;
    return Math.min(99, Math.max(82, profile.bestOvr + pickBoost));
  }
  if (profile.cheapUsefulSingle) return Math.min(82, profile.bestOvr + 4);
  if (profile.pickOnly) return profile.pickValue >= 35 ? 88 : profile.pickValue >= 18 ? 82 : 78;
  return Math.max(76, profile.bestOvr + 4);
}

function anchorMinOvr(profile = {}) {
  if (profile.star) return 72;
  if (profile.strong) return 70;
  if (profile.normal) return 66;
  if (profile.cheapUsefulSingle) return Math.max(58, profile.bestOvr - 10);
  return 60;
}

function makeAnchorPool(board = {}, profile = {}, leagueData = null) {
  const maxOvr = anchorMaxOvr(profile);
  const minOvr = anchorMinOvr(profile);
  const players = uniqueByFamilyKey([...(board.players || [])])
    .filter((item) => {
      const ovr = playerOvrOf(item);
      if (ovr < minOvr || ovr > maxOvr) return false;
      // Low-value searches should not spend time asking for giant bad salary
      // contracts unless the incoming salary/picks make that realistic.
      if (!profile.star && profile.salary < 14_000_000 && profile.pickValue < 18 && playerSalaryOf(item) > 28_000_000) return false;
      return true;
    })
    .sort((a, b) => {
      const ovrDiff = playerOvrOf(b) - playerOvrOf(a);
      if (Math.abs(ovrDiff) >= 2) return ovrDiff;
      return playerTradeScore(b, leagueData) - playerTradeScore(a, leagueData);
    });
  return players.slice(0, maxAnchors(profile));
}

function makeSupportPlayerPool(board = {}, anchor = null, profile = {}, leagueData = null) {
  const anchorKey = itemFamilyKey(anchor);
  const anchorOvr = playerOvrOf(anchor);
  const salaryTarget = Number(profile.salary || 0);
  const anchorSalary = playerSalaryOf(anchor);
  const needSalary = Math.max(0, salaryTarget * 0.75 - anchorSalary);
  const all = uniqueByFamilyKey([
    ...(board.highValuePlayers || []),
    ...(board.salaryPlayers || []),
    ...(board.efficientPlayers || []),
    ...(board.fillerPlayers || []),
  ]).filter((item) => item?.type === "player" && itemFamilyKey(item) !== anchorKey);

  return all
    .filter((item) => {
      const ovr = playerOvrOf(item);
      // Supporting players can be good, but the anchor should remain the main
      // piece. If this support is better than the anchor, it should have been its
      // own anchor path.
      if (ovr > anchorOvr && anchorOvr > 0) return false;
      if (!profile.star && ovr >= Math.max(88, profile.bestOvr + 7)) return false;
      return true;
    })
    .map((item) => {
      const salary = playerSalaryOf(item);
      const salaryFit = needSalary > 0 ? -Math.abs(salary - needSalary) / 1_000_000 : -Math.max(0, salary - 12_000_000) / 2_000_000;
      return {
        item,
        score: playerTradeScore(item, leagueData) + salaryFit * 1.35 + (salary >= 7_000_000 && salary <= 28_000_000 ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item)
    .slice(0, profile.star ? 16 : profile.strong ? 14 : 13);
}

function pushUniquePackage(out = [], seen = new Set(), items = []) {
  const cleaned = cleanPackage(items).filter((item) => item?.type === "player");
  if (!cleaned.length || cleaned.length > TRADE_FINDER_MAX_SIDE_ITEMS) return false;
  const key = packageKey(cleaned);
  if (seen.has(key)) return false;
  seen.add(key);
  out.push(cleaned);
  return true;
}

function generateAnchorCoreCandidates({ context, cpuTeam, board, anchor, profile }) {
  const leagueData = context.leagueData;
  const supportPool = makeSupportPlayerPool(board, anchor, profile, leagueData);
  const raw = [];
  const seen = new Set();

  // Candidate generation is salary-aware but player-first: keep the anchor fixed,
  // try strong player cores first, and ask the exact evaluator to decide whether
  // that core is too much for the CPU.
  pushUniquePackage(raw, seen, [anchor]);

  const s1 = supportPool.slice(0, profile.star ? 14 : 11);
  for (let i = 0; i < s1.length; i += 1) pushUniquePackage(raw, seen, [anchor, s1[i]]);

  const pairLimit = profile.star ? 13 : 10;
  for (let i = 0; i < Math.min(pairLimit, supportPool.length); i += 1) {
    for (let j = i + 1; j < Math.min(pairLimit + 2, supportPool.length); j += 1) {
      pushUniquePackage(raw, seen, [anchor, supportPool[i], supportPool[j]]);
    }
  }

  const tripleLimit = profile.star ? 10 : 8;
  if (profile.salary >= 18_000_000 || profile.star || profile.strong) {
    for (let i = 0; i < Math.min(tripleLimit, supportPool.length); i += 1) {
      for (let j = i + 1; j < Math.min(tripleLimit + 1, supportPool.length); j += 1) {
        for (let k = j + 1; k < Math.min(tripleLimit + 2, supportPool.length); k += 1) {
          pushUniquePackage(raw, seen, [anchor, supportPool[i], supportPool[j], supportPool[k]]);
        }
      }
    }
  }

  const legal = [];
  const illegal = [];
  for (const items of raw) {
    const row = {
      items,
      score: playerCoreScore(items, leagueData, profile),
      salary: packageSalary(items),
      value: packageValue(items, leagueData),
      lowFiller: 0,
    };
    if (financialOk({ context, cpuTeam, cpuItems: items })) {
      row.lowFiller = unnecessaryLowFillerCount({ context, cpuTeam, items, profile });
      legal.push(row);
    } else illegal.push(row);
  }

  legal.sort((a, b) => {
    // If the anchor alone is salary-legal, test it before adding extra players.
    // Extra players should repair salary, not pad a package that is already legal.
    const aLen = a.items.length;
    const bLen = b.items.length;
    if (aLen === 1 && bLen !== 1) return -1;
    if (bLen === 1 && aLen !== 1) return 1;

    // Do not beat a clean core by stacking unnecessary low-OVR filler. This is
    // the fix for Anthony Edwards/Jaden/Ayo being preferred over Ant/Jaden plus
    // multiple deep-bench players.
    if (a.lowFiller !== b.lowFiller) return a.lowFiller - b.lowFiller;

    const vectorDiff = compareOvrVectors(a.items, b.items);
    if (vectorDiff) return vectorDiff;

    // Higher player core first. Salary closeness is already inside score, but use
    // it as a tie-breaker so Mikal->Gordon-style packages stay clean.
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.5) return scoreDiff;
    const target = Number(profile.salary || 0);
    const aGap = target > 0 ? Math.abs(a.salary - target) : a.salary;
    const bGap = target > 0 ? Math.abs(b.salary - target) : b.salary;
    return aGap - bGap;
  });

  return {
    legal: legal.slice(0, MAX_CORE_TRIES_PER_ANCHOR).map((row) => row.items),
    legalCount: legal.length,
    rawCount: raw.length,
    illegalCount: illegal.length,
  };
}

function buildSupportPickLadder({ board, currentItems = [], profile, leagueData }) {
  const used = new Set((currentItems || []).map(itemFamilyKey));
  const firsts = (board?.firsts || []).filter((item) => !isSwapPickItem(item));
  const swaps = (board?.picks || []).filter(isSwapPickItem);
  const seconds = board?.seconds || [];

  // Try real firsts first, then swaps/seconds. If a strong support pick rejects,
  // the caller simply tries the next weaker support item.
  const all = uniqueByFamilyKey([...firsts, ...swaps, ...seconds])
    .filter((item) => !used.has(itemFamilyKey(item)))
    .sort((a, b) => {
      const aRound = pickRoundOf(a);
      const bRound = pickRoundOf(b);
      const aSwap = isSwapPickItem(a) ? 1 : 0;
      const bSwap = isSwapPickItem(b) ? 1 : 0;
      if (aRound !== bRound) return aRound - bRound;
      if (aSwap !== bSwap) return aSwap - bSwap;
      const valueDiff = assetValue(b, leagueData) - assetValue(a, leagueData);
      if (Math.abs(valueDiff) > 0.15) return valueDiff;
      return Number(a?.pick?.year || 9999) - Number(b?.pick?.year || 9999);
    });
  return all.slice(0, Math.max(8, supportPickLimit(profile) * 5));
}

function isBetterFinalOffer(candidate = null, current = null, context = {}) {
  if (!candidate) return false;
  if (!current) return true;
  const aItems = candidate.offer || [];
  const bItems = current.offer || [];
  const ladderDiff = comparePlayerOvrLadder(aItems, bItems);

  // Strict objective: once both packages are exact-accepted and comfortable,
  // the Trade Finder is a best-player discovery tool. A lower-OVR package may
  // not jump a higher-OVR package because it includes more picks or total value.
  if (ladderDiff !== 0) return ladderDiff > 0;

  const aPickCount = pickCount(aItems);
  const bPickCount = pickCount(bItems);
  if (aPickCount !== bPickCount) return aPickCount < bPickCount;

  if (aItems.length !== bItems.length) return aItems.length < bItems.length;

  const floor = Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR);
  const aMargin = Number(candidate.comfortMargin || 0);
  const bMargin = Number(current.comfortMargin || 0);
  const aClose = Math.abs(aMargin - (floor + COMFORT_TARGET_BUFFER));
  const bClose = Math.abs(bMargin - (floor + COMFORT_TARGET_BUFFER));
  if (Math.abs(aClose - bClose) > 0.25) return aClose < bClose;

  const aValue = Number(candidate.offerValue || 0);
  const bValue = Number(current.offerValue || 0);
  if (Math.abs(aValue - bValue) > 0.75) return aValue > bValue;

  const identityDiff = playerIdentityVector(aItems).localeCompare(playerIdentityVector(bItems));
  if (identityDiff !== 0) return identityDiff < 0;
  return compareOfferStrength(candidate, current) > 0;
}

function evaluateCore({ context, cpuTeam, items, allowExactFallback = false }) {
  // Fast scan is only a candidate gate. It is never displayed as final; the
  // selected package is builder-exact confirmed later.
  const scan = evaluateCpuPackage({ context, cpuTeam, cpuItems: items, mode: "scan", requireFinalValidation: true });
  if (scan || !allowExactFallback) return scan;
  return evaluateCpuPackage({ context, cpuTeam, cpuItems: items, mode: BUILDER_EXACT_MODE, requireFinalValidation: true });
}


function confirmAndTightenWithBuilderExact({ context, cpuTeam, candidateItems = [] }) {
  const tryExact = (items) => evaluateCpuPackage({ context, cpuTeam, cpuItems: cleanPackage(items), mode: BUILDER_EXACT_MODE, requireFinalValidation: true });

  let currentItems = cleanPackage(candidateItems);
  let exact = tryExact(currentItems);

  // Final displayed offers must pass the exact same builder evaluator as
  // Propose Trade. If scan mode had a pick-heavy candidate, remove picks one at
  // a time; never replace the accepted player core with lower-OVR value filler.
  while (!exact && currentItems.some((item) => item?.type === "pick")) {
    const idx = [...currentItems].map((item, index) => ({ item, index })).reverse().find((row) => row.item?.type === "pick")?.index;
    if (idx === undefined || idx < 0) break;
    currentItems = currentItems.filter((_, index) => index !== idx);
    exact = tryExact(currentItems);
  }

  return { offer: exact || null, exactTightenAttempts: 1 };
}

function optimizeAcceptedCoreWithSupport({ context, cpuTeam, coreResult }) {
  // With strict highest-OVR ranking, support picks can only make a package less
  // clean once an accepted player core exists. Exact-confirm the player core and
  // avoid extra support probes; this improves speed and prevents lower-player
  // value piles from replacing cleaner high-OVR returns.
  const confirmed = confirmAndTightenWithBuilderExact({
    context,
    cpuTeam,
    candidateItems: coreResult?.offer || [],
  });
  return {
    offer: confirmed.offer,
    supportAttempts: Number(confirmed.exactTightenAttempts || 0),
    supportAccepted: 0,
    supportRejected: 0,
  };
}

function buildPickOnlyCandidateLadder({ board, leagueData }) {
  const picks = uniqueByFamilyKey([
    ...(board?.firsts || []),
    ...(board?.seconds || []),
    ...(board?.picks || []).filter(isSwapPickItem),
  ]).sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData));
  const ladder = [];
  const seen = new Set();
  const push = (items) => {
    const cleaned = cleanPackage(items).filter((item) => item?.type === "pick");
    if (!cleaned.length) return;
    const key = packageKey(cleaned);
    if (seen.has(key)) return;
    seen.add(key);
    ladder.push(cleaned);
  };
  for (const pick of picks.slice(0, 12)) push([pick]);
  for (let i = 0; i < Math.min(10, picks.length); i += 1) {
    for (let j = i + 1; j < Math.min(12, picks.length); j += 1) {
      push([picks[i], picks[j]]);
      if (ladder.length >= 22) break;
    }
    if (ladder.length >= 22) break;
  }
  return ladder.slice(0, 22);
}

function findBestPickOnlyOfferForTeam({ context, cpuTeam, board, signal = null }) {
  const ladder = buildPickOnlyCandidateLadder({ board, leagueData: context.leagueData });
  let best = null;
  let checks = 0;
  for (const items of ladder) {
    if (isCancelled(signal)) break;
    checks += 1;
    const result = evaluateCore({ context, cpuTeam, items, allowExactFallback: checks <= 3 });
    if (isBetterFinalOffer(result, best, context)) best = result;
    if (best && Number(best.comfortMargin || 0) <= Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR) + 1.0) break;
    if (checks >= 14) break;
  }
  return best ? withSearchStats(best, { engine: "v11_pick_only_ladder", coreChecks: checks, exactConfirmAttempts: checks, comfortFloor: context.comfortFloor }) : null;
}

async function findBestOfferForTeam({ context, cpuTeam, teamIndex = 0, teamsToCheck = 0, onProgress = null, signal = null }) {
  const teamStartedAt = nowMs();
  const cpuName = getTeamName(cpuTeam);
  const beforeMetrics = { ...context.metrics };
  const board = buildAssetBoard(cpuTeam, context.leagueData);
  const profile = selectedProfile(context);

  if (profile.pickOnly) {
    const pickOnlyOffer = findBestPickOnlyOfferForTeam({ context, cpuTeam, board, signal });
    const teamMs = nowMs() - teamStartedAt;
    return withSearchStats(pickOnlyOffer, {
      ...(pickOnlyOffer?.searchStats || {}),
      teamMs: round1(teamMs),
      comfortFloor: context.comfortFloor,
      skipReason: pickOnlyOffer ? null : "no exact-comfortable pick-only package",
    });
  }

  safeProgress(onProgress, { phase: "team_start", team: cpuName, teamIndex, teamsToCheck, offersFound: 0 });
  safeProgress(onProgress, { phase: "evaluating", team: cpuName, teamIndex, teamsToCheck, evaluationsForTeam: 0 });

  const anchors = makeAnchorPool(board, profile, context.leagueData);
  let best = null;
  let anchorsChecked = 0;
  let coreChecks = 0;
  let acceptedCores = 0;
  let rejectedCores = 0;
  let generatedCores = 0;
  let illegalCores = 0;
  let supportAttempts = 0;
  let supportAccepted = 0;
  let supportRejected = 0;
  let bestRejectedCore = null;
  const maxCoreEvals = MAX_TOTAL_CORE_EVALS_PER_TEAM;

  for (const anchor of anchors) {
    if (isCancelled(signal)) break;
    if (coreChecks >= maxCoreEvals) break;
    anchorsChecked += 1;
    const coreRows = generateAnchorCoreCandidates({ context, cpuTeam, board, anchor, profile });
    generatedCores += coreRows.rawCount;
    illegalCores += coreRows.illegalCount;
    const legalCores = coreRows.legal;
    if (!legalCores.length) continue;

    let anchorAccepted = null;
    let anchorRejected = 0;
    let acceptedForAnchor = 0;
    const maxAcceptedForAnchor = profile.star ? 4 : profile.strong ? 4 : 5;
    const maxCheckedForAnchor = profile.star ? 10 : profile.strong ? 10 : 12;
    for (let idx = 0; idx < legalCores.length; idx += 1) {
      if (isCancelled(signal)) break;
      if (coreChecks >= maxCoreEvals) break;
      if (idx >= maxCheckedForAnchor && anchorAccepted) break;
      const coreItems = legalCores[idx];
      coreChecks += 1;
      safeProgress(onProgress, {
        phase: "exact_core",
        team: cpuName,
        teamIndex,
        teamsToCheck,
        finalistIndex: coreChecks,
        finalistCount: maxCoreEvals,
        items: coreItems.map((item) => item.label || item.player?.name || item.type),
      });
      const coreResult = evaluateCore({ context, cpuTeam, items: coreItems, allowExactFallback: idx < 2 });
      if (coreResult) {
        acceptedForAnchor += 1;
        acceptedCores += 1;
        if (isBetterFinalOffer(coreResult, anchorAccepted, context)) anchorAccepted = coreResult;
        if (acceptedForAnchor >= maxAcceptedForAnchor) break;
        continue;
      }
      anchorRejected += 1;
      rejectedCores += 1;
      if (!bestRejectedCore) bestRejectedCore = coreItems;
    }

    if (!anchorAccepted) {
      // If even the best legal cores for this anchor reject or miss comfort, move
      // down the anchor ladder. This is the core player-first behavior.
      continue;
    }

    const optimized = optimizeAcceptedCoreWithSupport({ context, cpuTeam, board, coreResult: anchorAccepted, signal });
    supportAttempts += optimized.supportAttempts;
    supportAccepted += optimized.supportAccepted;
    supportRejected += optimized.supportRejected;
    if (isBetterFinalOffer(optimized.offer, best, context)) best = optimized.offer;

    // Strict best-player mode: anchors are sorted from highest OVR downward.
    // Once the current accepted best starts with a higher OVR than the next
    // available anchor, lower anchors cannot beat it by adding picks/value, so
    // stop early for both better results and speed.
    const nextAnchor = anchors[anchorsChecked] || null;
    const bestTopOvr = ovrVector(best?.offer || [])[0] || 0;
    const nextAnchorOvr = nextAnchor ? playerOvrOf(nextAnchor) : 0;
    if (!nextAnchor || bestTopOvr > nextAnchorOvr) break;

    if (!profile.star && acceptedCores >= 4) break;
    if (profile.star && acceptedCores >= 5) break;
  }

  const teamMs = nowMs() - teamStartedAt;
  const exactEvals = Number(context.metrics.exactEvaluations || 0) - Number(beforeMetrics.exactEvaluations || 0);
  const scanEvals = Number(context.metrics.scanEvaluations || 0) - Number(beforeMetrics.scanEvaluations || 0);
  const stats = {
    teamMs: round1(teamMs),
    anchorsAvailable: anchors.length,
    anchorsChecked,
    generatedCores,
    illegalCores,
    coreChecks,
    exactConfirmAttempts: coreChecks + supportAttempts,
    exactConfirmedCores: acceptedCores,
    exactRejectedCores: rejectedCores,
    supportProbes: supportAttempts,
    supportAccepted,
    rejectedSupport: supportRejected,
    evaluations: exactEvals + scanEvals,
    exactEvaluations: exactEvals,
    scanEvaluations: scanEvals,
    comfortFloor: context.comfortFloor,
    engine: "v12_builder_exact_best_player_anchor",
    bestRejectedCore: bestRejectedCore?.map((item) => item.label || item.player?.name || item.type) || null,
    skipReason: best ? null : "no exact-comfortable salary-aware player-first package",
  };

  debugLog("team done", { team: cpuName, ...stats, offer: makeOfferDebugSummary(best) });
  return withSearchStats(best, stats);
}

function sortFinalOffers(offers = []) {
  return (offers || []).slice().sort((a, b) => {
    const ladderDiff = comparePlayerOvrLadder(a?.offer || [], b?.offer || []);
    if (ladderDiff !== 0) return ladderDiff > 0 ? -1 : 1;

    const aPickCount = pickCount(a?.offer || []);
    const bPickCount = pickCount(b?.offer || []);
    if (aPickCount !== bPickCount) return aPickCount - bPickCount;

    const aLen = (a?.offer || []).length;
    const bLen = (b?.offer || []).length;
    if (aLen !== bLen) return aLen - bLen;

    const marginA = Number(a.comfortMargin || 0);
    const marginB = Number(b.comfortMargin || 0);
    const floorA = Number(a.searchStats?.comfortFloor ?? TRADE_FINDER_COMFORT_FLOOR);
    const floorB = Number(b.searchStats?.comfortFloor ?? TRADE_FINDER_COMFORT_FLOOR);
    const closeDiff = Math.abs(marginA - floorA) - Math.abs(marginB - floorB);
    if (Math.abs(closeDiff) > 0.25) return closeDiff;

    const valueDiff = Number(b.offerValue || 0) - Number(a.offerValue || 0);
    if (Math.abs(valueDiff) > 0.5) return valueDiff;
    return getTeamName(a?.team).localeCompare(getTeamName(b?.team));
  });
}

export async function findComfortableTradeFinderOffers({
  leagueData,
  selectedTeam,
  selectedItems = [],
  teams = [],
  onProgress = null,
  signal = null,
  searchMode = "accurate",
} = {}) {
  const startedAt = nowMs();
  const allTeams = teams?.length ? teams : getAllTeamsFromLeagueData(leagueData);
  const checkTeams = allTeams.filter((team) => !sameTeamName(getTeamName(team), getTeamName(selectedTeam)));
  const baseContext = makeTradeFinderEvalContext({ leagueData, selectedTeam, selectedItems });
  const offers = [];
  const teamSummaries = [];
  const aggregateMetrics = { ...baseContext.metrics };

  safeProgress(onProgress, {
    phase: "scan_start",
    team: "",
    teamIndex: 0,
    teamsToCheck: checkTeams.length,
    offersFound: 0,
    elapsedSec: 0,
    searchMode,
    searchProfile: "v12_builder_exact_best_player_anchor",
  });

  debugLog("search start", {
    engine: "v12_builder_exact_best_player_anchor",
    selectedTeam: getTeamName(selectedTeam),
    selectedValue: round1(packageValue(selectedItems, leagueData)),
    selectedAssets: selectedItems.length,
    comfortFloor: baseContext.comfortFloor,
    teamsToCheck: checkTeams.length,
  });

  for (let index = 0; index < checkTeams.length; index += 1) {
    if (isCancelled(signal)) break;
    const cpuTeam = checkTeams[index];
    safeProgress(onProgress, {
      phase: "team_queue",
      team: getTeamName(cpuTeam),
      teamIndex: index + 1,
      teamsToCheck: checkTeams.length,
      offersFound: offers.length,
      elapsedSec: round1((nowMs() - startedAt) / 1000),
    });

    try {
      resetTradeFinderImpactSearchCaches({ keepPowerContext: true });
    } catch {}

    const teamStart = nowMs();
    const context = makeTradeFinderEvalContext({
      leagueData,
      selectedTeam,
      selectedItems,
      comfortFloor: baseContext.comfortFloor,
    });
    const beforeMetrics = { ...context.metrics };
    const offer = await findBestOfferForTeam({
      context,
      cpuTeam,
      teamIndex: index + 1,
      teamsToCheck: checkTeams.length,
      onProgress: (progress) =>
        safeProgress(onProgress, { ...progress, offersFound: offers.length, elapsedSec: round1((nowMs() - startedAt) / 1000) }),
      signal,
    });

    if (offer) offers.push(offer);

    const teamMs = nowMs() - teamStart;
    const evaluationsForTeam =
      Number(context.metrics.exactEvaluations || 0) - Number(beforeMetrics.exactEvaluations || 0) +
      Number(context.metrics.scanEvaluations || 0) - Number(beforeMetrics.scanEvaluations || 0);
    const summary = {
      team: getTeamName(cpuTeam),
      foundOffer: Boolean(offer),
      teamMs: round1(teamMs),
      evaluationsForTeam,
      offer: makeOfferDebugSummary(offer),
      stats: offer?.searchStats || null,
    };
    teamSummaries.push(summary);
    for (const [metricKey, metricValue] of Object.entries(context.metrics || {})) {
      aggregateMetrics[metricKey] = Number(aggregateMetrics[metricKey] || 0) + Number(metricValue || 0);
    }

    safeProgress(onProgress, {
      phase: "team_done",
      team: getTeamName(cpuTeam),
      teamIndex: index + 1,
      teamsToCheck: checkTeams.length,
      offersFound: offers.length,
      elapsedSec: round1((nowMs() - startedAt) / 1000),
      teamMs,
      evaluationsForTeam,
    });

    if ((index + 1) % SEARCH_YIELD_EVERY_TEAMS === 0) await yieldToBrowser();
  }

  const finalOffers = sortFinalOffers(offers).map((offer) => ({ ...offer, offer: sortTradeFinderOfferItems(offer.offer, leagueData) }));
  const elapsedSec = round1((nowMs() - startedAt) / 1000);
  const stopped = isCancelled(signal);
  const debugPayload = {
    engine: "v12_builder_exact_best_player_anchor",
    policy:
      "builder-exact strict highest-OVR player anchor optimizer; displayed offers use same score as Propose Trade; lower-OVR value piles/picks cannot beat higher-OVR accepted player cores",
    comfortFloor: baseContext.comfortFloor,
    teamsChecked: checkTeams.length,
    offersFound: finalOffers.length,
    elapsedSec,
    selectedValue: round1(packageValue(selectedItems, leagueData)),
    metrics: { ...aggregateMetrics },
    offers: finalOffers.map(makeOfferDebugSummary),
    teamSummaries,
  };

  try {
    if (typeof window !== "undefined") window.__TF_LAST_DEBUG = debugPayload;
  } catch {}
  debugLog("search complete", debugPayload);

  safeProgress(onProgress, {
    phase: stopped ? "stopped" : "complete",
    team: "",
    teamIndex: checkTeams.length,
    teamsToCheck: checkTeams.length,
    offersFound: finalOffers.length,
    elapsedSec,
    searchMode,
    searchProfile: "v12_builder_exact_best_player_anchor",
  });

  return { offers: finalOffers, teamsChecked: checkTeams.length, stopped, elapsedSec, debug: debugPayload };
}
