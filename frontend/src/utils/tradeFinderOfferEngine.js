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


function addTimingMs(timing = {}, key, ms) {
  if (!timing || !key) return timing;
  const value = Number(ms || 0);
  timing[key] = Number(timing[key] || 0) + value;
  return timing;
}

function roundTimingMap(timing = {}) {
  const out = {};
  for (const [key, value] of Object.entries(timing || {})) out[key] = round1(value);
  return out;
}

function cloneMetrics(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => [key, Number(value || 0)]));
}

function diffMetrics(after = {}, before = {}) {
  const out = {};
  const keys = new Set([...Object.keys(after || {}), ...Object.keys(before || {})]);
  for (const key of keys) out[key] = Number(after?.[key] || 0) - Number(before?.[key] || 0);
  return out;
}

function offerSignatureFromSummary(offer = {}) {
  const items = Array.isArray(offer?.items) ? offer.items : [];
  return `${offer?.team || ""}::${items.join("||")}`;
}

function normalizeDebugOffer(offer = {}, index = 0) {
  const items = Array.isArray(offer?.items) ? offer.items.slice() : [];
  return {
    rank: index + 1,
    team: offer?.team || "",
    value: round1(offer?.value),
    gap: round1(offer?.gap),
    comfortMargin: round1(offer?.comfortMargin),
    assets: Number(offer?.assets || items.length || 0),
    items,
    signature: `${offer?.team || ""}::${items.join("||")}`,
  };
}

function makeTradeFinderBaselineSnapshot(debugPayload = null) {
  const debug = debugPayload || (typeof window !== "undefined" ? window.__TF_LAST_DEBUG : null);
  if (!debug) return null;
  const offers = (debug.offers || []).map(normalizeDebugOffer);
  return {
    snapshotVersion: 1,
    createdAt: new Date().toISOString(),
    engine: debug.engine,
    policy: debug.policy,
    selectedTeam: debug.selectedTeam || "",
    selectedValue: round1(debug.selectedValue),
    selectedAssets: Number(debug.selectedAssets || 0),
    comfortFloor: Number(debug.comfortFloor || 0),
    teamsChecked: Number(debug.teamsChecked || 0),
    offersFound: Number(debug.offersFound || offers.length || 0),
    elapsedSec: round1(debug.elapsedSec),
    metrics: cloneMetrics(debug.metrics || {}),
    timing: debug.timing || {},
    offers,
    teamSummaries: (debug.teamSummaries || []).map((team) => ({
      team: team.team,
      foundOffer: Boolean(team.foundOffer),
      teamMs: round1(team.teamMs),
      evaluationsForTeam: Number(team.evaluationsForTeam || 0),
      offer: team.offer ? normalizeDebugOffer(team.offer, 0) : null,
      stats: team.stats || null,
      timing: team.timing || team.stats?.timing || null,
      metrics: team.metrics || team.stats?.metrics || null,
    })),
  };
}

function compareTradeFinderSnapshots(currentSnapshot = null, baselineSnapshot = null) {
  const current = currentSnapshot?.offers ? currentSnapshot : makeTradeFinderBaselineSnapshot(currentSnapshot);
  const baseline = baselineSnapshot?.offers ? baselineSnapshot : makeTradeFinderBaselineSnapshot(baselineSnapshot);
  if (!current || !baseline) return { ok: false, reason: "missing current or baseline snapshot", current, baseline };

  const baselineByTeam = new Map((baseline.offers || []).map((offer) => [offer.team, offer]));
  const currentByTeam = new Map((current.offers || []).map((offer) => [offer.team, offer]));
  const rows = [];
  const teams = Array.from(new Set([...(baseline.offers || []).map((o) => o.team), ...(current.offers || []).map((o) => o.team)]));

  for (const team of teams) {
    const before = baselineByTeam.get(team);
    const after = currentByTeam.get(team);
    if (!before || !after) {
      rows.push({
        team,
        status: before ? "missing_after" : "added_after",
        beforeItems: before?.items?.join(" | ") || "",
        afterItems: after?.items?.join(" | ") || "",
        beforeValue: before?.value ?? "",
        afterValue: after?.value ?? "",
        beforeMargin: before?.comfortMargin ?? "",
        afterMargin: after?.comfortMargin ?? "",
      });
      continue;
    }
    const sameItems = before.signature === after.signature;
    const sameValue = Math.abs(Number(before.value || 0) - Number(after.value || 0)) < 0.05;
    const sameMargin = Math.abs(Number(before.comfortMargin || 0) - Number(after.comfortMargin || 0)) < 0.05;
    const sameRank = Number(before.rank || 0) === Number(after.rank || 0);
    if (!sameItems || !sameValue || !sameMargin || !sameRank) {
      rows.push({
        team,
        status: sameItems && sameValue && sameMargin ? "rank_changed" : "changed",
        beforeRank: before.rank,
        afterRank: after.rank,
        beforeValue: before.value,
        afterValue: after.value,
        beforeMargin: before.comfortMargin,
        afterMargin: after.comfortMargin,
        beforeItems: before.items.join(" | "),
        afterItems: after.items.join(" | "),
      });
    }
  }

  const ok = rows.length === 0 && Number(current.offersFound || 0) === Number(baseline.offersFound || 0);
  return {
    ok,
    changedCount: rows.length,
    rows,
    speed: {
      baselineSec: Number(baseline.elapsedSec || 0),
      currentSec: Number(current.elapsedSec || 0),
      deltaSec: round1(Number(current.elapsedSec || 0) - Number(baseline.elapsedSec || 0)),
      speedup: Number(current.elapsedSec || 0) > 0 ? round1(Number(baseline.elapsedSec || 0) / Number(current.elapsedSec || 1)) : null,
    },
    metricsDelta: diffMetrics(current.metrics || {}, baseline.metrics || {}),
    current,
    baseline,
  };
}

function installTradeFinderBaselineTools(debugPayload = null) {
  if (typeof window === "undefined") return;
  const storagePrefix = "bm_trade_finder_baseline_v1:";
  const tools = {
    makeSnapshot(debug = window.__TF_LAST_DEBUG) {
      return makeTradeFinderBaselineSnapshot(debug);
    },
    saveBaseline(name = "baseline", debug = window.__TF_LAST_DEBUG) {
      const snapshot = makeTradeFinderBaselineSnapshot(debug);
      if (!snapshot) {
        console.warn("No Trade Finder debug payload available to save.");
        return null;
      }
      localStorage.setItem(`${storagePrefix}${name}`, JSON.stringify(snapshot));
      window.__TF_BASELINE = snapshot;
      console.log(`[TF BASELINE] saved '${name}'`, snapshot);
      return snapshot;
    },
    loadBaseline(name = "baseline") {
      try {
        const raw = localStorage.getItem(`${storagePrefix}${name}`);
        const snapshot = raw ? JSON.parse(raw) : null;
        if (snapshot) window.__TF_BASELINE = snapshot;
        return snapshot;
      } catch (error) {
        console.warn("Failed to load Trade Finder baseline", error);
        return null;
      }
    },
    listBaselines() {
      return Object.keys(localStorage)
        .filter((key) => key.startsWith(storagePrefix))
        .map((key) => key.slice(storagePrefix.length));
    },
    compareToBaseline(nameOrSnapshot = "baseline", debug = window.__TF_LAST_DEBUG) {
      const baseline = typeof nameOrSnapshot === "string" ? tools.loadBaseline(nameOrSnapshot) : nameOrSnapshot;
      const current = makeTradeFinderBaselineSnapshot(debug);
      const diff = compareTradeFinderSnapshots(current, baseline);
      console.log("[TF BASELINE] compare result", diff);
      if (diff?.rows?.length) console.table(diff.rows);
      else console.log("[TF BASELINE] exact match on teams, order, values, margins, and item lists.");
      return diff;
    },
    printTiming(debug = window.__TF_LAST_DEBUG) {
      if (!debug) return console.warn("No Trade Finder debug payload available.");
      console.log("[TF TIMING] overall", debug.timing || {});
      console.table(
        (debug.teamSummaries || [])
          .slice()
          .sort((a, b) => Number(b.teamMs || 0) - Number(a.teamMs || 0))
          .map((team) => ({
            team: team.team,
            teamMs: team.teamMs,
            evals: team.evaluationsForTeam,
            exact: team.metrics?.exactEvaluations ?? team.stats?.metrics?.exactEvaluations ?? team.stats?.exactEvaluations,
            scan: team.metrics?.scanEvaluations ?? team.stats?.metrics?.scanEvaluations ?? team.stats?.scanEvaluations,
            impactMs: round1(team.metrics?.impactMs ?? team.stats?.metrics?.impactMs ?? 0),
            validationMs: round1(team.metrics?.validationMs ?? team.stats?.metrics?.validationMs ?? 0),
            boardMs: round1(team.timing?.buildAssetBoardMs ?? team.stats?.timing?.buildAssetBoardMs ?? 0),
            coreGenMs: round1(team.timing?.generateCoresMs ?? team.stats?.timing?.generateCoresMs ?? 0),
            coreEvalMs: round1(team.timing?.coreEvaluateMs ?? team.stats?.timing?.coreEvaluateMs ?? 0),
            supportMs: round1(team.timing?.supportOptimizeMs ?? team.stats?.timing?.supportOptimizeMs ?? 0),
            offer: team.offer?.items?.join(" | ") || "",
          }))
      );
      return debug.timing || {};
    },
    copySnapshot(debug = window.__TF_LAST_DEBUG) {
      const snapshot = makeTradeFinderBaselineSnapshot(debug);
      const text = JSON.stringify(snapshot, null, 2);
      if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
      console.log(text);
      return snapshot;
    },
    compareSnapshots: compareTradeFinderSnapshots,
  };
  window.__TF_BASELINE_TOOLS = tools;
  window.saveTradeFinderBaseline = tools.saveBaseline;
  window.compareTradeFinderBaseline = tools.compareToBaseline;
  window.printTradeFinderTiming = tools.printTiming;
}

function isCancelled(signal) {
  return Boolean(signal?.aborted);
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}


function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function getTradeFinderWorkerPoolSize(teamCount = 0) {
  if (teamCount <= 1) return 0;
  try {
    if (typeof window === "undefined" || typeof Worker === "undefined") return 0;
    const raw = window.localStorage?.getItem("bm_tf_worker_pool_size");
    if (raw === "0" || String(raw || "").toLowerCase() === "off") return 0;

    // Best confirmed local baseline:
    // - Sabonis exact match: 8 workers in 75.4s
    // - Tatum exact match: 8 workers in 37.1s
    // Higher counts were slower on the tested machine, so default to 8 only
    // when the browser reports enough cores. Users can still override with
    // localStorage for testing.
    const hardware = clampNumber(window.navigator?.hardwareConcurrency || 8, 2, 16, 8);
    const defaultSize = Math.min(8, Math.max(2, hardware - 1), teamCount);
    return clampNumber(raw, 1, Math.min(8, teamCount), defaultSize);
  } catch {
    return 0;
  }
}

function chunkTeamsRoundRobin(teams = [], workerCount = 1) {
  const chunks = Array.from({ length: Math.max(1, workerCount) }, () => ({ teams: [], teamIndices: [] }));
  for (let index = 0; index < teams.length; index += 1) {
    const bucket = index % chunks.length;
    chunks[bucket].teams.push(teams[index]);
    chunks[bucket].teamIndices.push(index + 1);
  }
  return chunks.filter((chunk) => chunk.teams.length);
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

function pickCount(items = []) {
  return (items || []).filter((item) => item?.type === "pick").length;
}

function isBetterFinalOffer(candidate = null, current = null, context = {}) {
  if (!candidate) return false;
  if (!current) return true;

  const profile = selectedProfile(context);
  const aItems = candidate.offer || [];
  const bItems = current.offer || [];

  // Hard objective: among exact-accepted packages, the Finder is a best-player
  // discovery tool. A lower-OVR player ladder cannot beat a higher-OVR ladder
  // because it carries more picks/value.
  const ovrDiff = compareOvrVectors(aItems, bItems);
  if (ovrDiff !== 0) return ovrDiff < 0;

  const aValue = Number(candidate.offerValue || 0);
  const bValue = Number(current.offerValue || 0);
  const aMargin = Number(candidate.comfortMargin || 0);
  const bMargin = Number(current.comfortMargin || 0);
  const floor = Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR);
  const target = floor + COMFORT_TARGET_BUFFER;
  const aClose = Math.abs(aMargin - target);
  const bClose = Math.abs(bMargin - target);
  const aStillCpuLean = aMargin > floor + (profile.star ? 8 : profile.strong ? 6 : 4);
  const bStillCpuLean = bMargin > floor + (profile.star ? 8 : profile.strong ? 6 : 4);

  // Same player ladder: allow picks/swaps/seconds to bridge the gap toward the
  // desired comfort zone. This is what lets ATL add picks after Jalen/Kuminga,
  // while still preventing a Nickeil/Dyson/CJ pile from beating Jalen.
  if (aStillCpuLean && bStillCpuLean && Math.abs(aValue - bValue) > 0.75) return aValue > bValue;
  if (Math.abs(aClose - bClose) > 0.25) return aClose < bClose;
  if (Math.abs(aValue - bValue) > (profile.star ? 3.0 : 1.5)) return aValue > bValue;

  // Deep tie-breakers only after the player ladder, comfort, and value are tied.
  const aPicks = pickCount(aItems);
  const bPicks = pickCount(bItems);
  if (aPicks !== bPicks) return aPicks > bPicks;
  if (aItems.length !== bItems.length) return aItems.length < bItems.length;
  return compareOfferStrength(candidate, current) > 0;
}

function evaluateCore({ context, cpuTeam, items, allowExactFallback = false }) {
  // Fast scan is only a candidate gate. It is never displayed as final; the
  // selected package is builder-exact confirmed later.
  const scan = evaluateCpuPackage({ context, cpuTeam, cpuItems: items, mode: "scan", requireFinalValidation: true });
  if (scan || !allowExactFallback) return scan;
  return evaluateCpuPackage({ context, cpuTeam, cpuItems: items, mode: BUILDER_EXACT_MODE, requireFinalValidation: true });
}


function confirmAndTightenWithBuilderExact({ context, cpuTeam, board, candidateItems = [], profile = {}, leagueData = null, signal = null }) {
  const floor = Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR);
  const stopBuffer = profile.star ? 2.75 : profile.strong ? 2.0 : profile.normal ? 1.35 : 1.0;
  const supportLimit = Math.min(supportPickLimit(profile), TRADE_FINDER_MAX_SIDE_ITEMS - cleanPackage(candidateItems).length);

  const tryExact = (items) => evaluateCpuPackage({ context, cpuTeam, cpuItems: cleanPackage(items), mode: BUILDER_EXACT_MODE, requireFinalValidation: true });

  let currentItems = cleanPackage(candidateItems);
  let exact = tryExact(currentItems);

  // If the fast scan over-added support and the real builder evaluator rejects,
  // remove picks/swaps one at a time. Do not mutate the player core.
  while (!exact && currentItems.some((item) => item?.type === "pick")) {
    const idx = [...currentItems].map((item, index) => ({ item, index })).reverse().find((row) => row.item?.type === "pick")?.index;
    if (idx === undefined || idx < 0) break;
    currentItems = currentItems.filter((_, index) => index !== idx);
    exact = tryExact(currentItems);
  }

  if (!exact) return { offer: null, exactTightenAttempts: 1 };

  let best = exact;
  let attempts = 1;
  if (Number(best.comfortMargin || 0) <= floor + stopBuffer) {
    return { offer: best, exactTightenAttempts: attempts };
  }

  const supportPool = buildSupportPickLadder({ board, currentItems: best.offer, profile, leagueData });
  let acceptedSupport = 0;
  let rejectedSupport = 0;
  currentItems = cleanPackage(best.offer || []);

  for (const support of supportPool) {
    if (isCancelled(signal)) break;
    if (acceptedSupport >= supportLimit) break;
    if (attempts >= 1 + Math.min(6, MAX_SUPPORT_EVALS_PER_TEAM)) break;
    if (currentItems.length >= TRADE_FINDER_MAX_SIDE_ITEMS) break;
    if (currentItems.some((item) => itemFamilyKey(item) === itemFamilyKey(support))) continue;

    const candidate = cleanPackage([...currentItems, support]);
    attempts += 1;
    const supported = tryExact(candidate);
    if (supported) {
      acceptedSupport += 1;
      currentItems = cleanPackage(supported.offer || candidate);
      if (isBetterFinalOffer(supported, best, context)) best = supported;
      if (Number(supported.comfortMargin || 0) <= floor + stopBuffer) break;
    } else {
      rejectedSupport += 1;
      if (rejectedSupport >= 3 && Number(best.comfortMargin || 0) <= floor + stopBuffer + 1.5) break;
    }
  }

  return { offer: best, exactTightenAttempts: attempts };
}

function optimizeAcceptedCoreWithSupport({ context, cpuTeam, board, coreResult, signal = null }) {
  const profile = selectedProfile(context);
  const leagueData = context.leagueData;
  const maxSupport = Math.min(supportPickLimit(profile), TRADE_FINDER_MAX_SIDE_ITEMS - (coreResult.offer || []).filter(Boolean).length);
  const supportPool = buildSupportPickLadder({ board, currentItems: coreResult.offer, profile, leagueData });
  let currentItems = cleanPackage(coreResult.offer || []);
  let best = coreResult;
  let supportAttempts = 0;
  let supportAccepted = 0;
  let supportRejected = 0;
  const startingMargin = Number(coreResult?.comfortMargin || 0);
  const startingStopBuffer = profile.star ? 2.25 : profile.strong ? 1.65 : profile.normal ? 1.15 : 0.85;
  if (startingMargin <= Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR) + startingStopBuffer) {
    const confirmed = confirmAndTightenWithBuilderExact({ context, cpuTeam, board, candidateItems: best?.offer || currentItems, profile, leagueData, signal });
    return { offer: confirmed.offer, supportAttempts: supportAttempts + Number(confirmed.exactTightenAttempts || 0), supportAccepted, supportRejected };
  }

  for (const support of supportPool) {
    if (isCancelled(signal)) break;
    if (supportAttempts >= MAX_SUPPORT_EVALS_PER_TEAM) break;
    if (supportAccepted >= maxSupport) break;
    if (currentItems.length >= TRADE_FINDER_MAX_SIDE_ITEMS) break;
    if (currentItems.some((item) => itemFamilyKey(item) === itemFamilyKey(support))) continue;

    const candidateItems = cleanPackage([...currentItems, support]);
    supportAttempts += 1;
    const supported = evaluateCpuPackage({ context, cpuTeam, cpuItems: candidateItems, mode: "scan", requireFinalValidation: true });
    if (supported) {
      currentItems = candidateItems;
      supportAccepted += 1;
      if (isBetterFinalOffer(supported, best, context)) best = supported;

      // If we are now close to the desired comfort floor, one more support piece
      // is usually unnecessary. If the CPU is still very comfortable, keep adding.
      const margin = Number(supported.comfortMargin || 0);
      const stopBuffer = profile.star ? 2.75 : profile.strong ? 2.0 : profile.normal ? 1.35 : 1.0;
      if (margin <= Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR) + stopBuffer) break;
    } else {
      supportRejected += 1;
      const currentMargin = Number(best?.comfortMargin || 0);
      if (supportRejected >= 3 && currentMargin <= Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR) + 2.75) break;
      // Do not salvage a rejected support package by changing players. Just try
      // the next weaker pick/swap/second.
    }
  }

  const confirmed = confirmAndTightenWithBuilderExact({
    context,
    cpuTeam,
    board,
    candidateItems: best?.offer || currentItems,
    profile,
    leagueData,
    signal,
  });
  return {
    offer: confirmed.offer,
    supportAttempts: supportAttempts + Number(confirmed.exactTightenAttempts || 0),
    supportAccepted,
    supportRejected,
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
  const teamTiming = {};
  const beforeMetrics = cloneMetrics(context.metrics);
  let phaseStartedAt = nowMs();
  const board = buildAssetBoard(cpuTeam, context.leagueData);
  addTimingMs(teamTiming, "buildAssetBoardMs", nowMs() - phaseStartedAt);
  phaseStartedAt = nowMs();
  const profile = selectedProfile(context);
  addTimingMs(teamTiming, "selectedProfileMs", nowMs() - phaseStartedAt);

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

  phaseStartedAt = nowMs();
  const anchors = makeAnchorPool(board, profile, context.leagueData);
  addTimingMs(teamTiming, "makeAnchorPoolMs", nowMs() - phaseStartedAt);
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
    phaseStartedAt = nowMs();
    const coreRows = generateAnchorCoreCandidates({ context, cpuTeam, board, anchor, profile });
    addTimingMs(teamTiming, "generateCoresMs", nowMs() - phaseStartedAt);
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
      phaseStartedAt = nowMs();
      const coreResult = evaluateCore({ context, cpuTeam, items: coreItems, allowExactFallback: idx < 2 });
      addTimingMs(teamTiming, "coreEvaluateMs", nowMs() - phaseStartedAt);
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

    phaseStartedAt = nowMs();
    const optimized = optimizeAcceptedCoreWithSupport({ context, cpuTeam, board, coreResult: anchorAccepted, signal });
    addTimingMs(teamTiming, "supportOptimizeMs", nowMs() - phaseStartedAt);
    supportAttempts += optimized.supportAttempts;
    supportAccepted += optimized.supportAccepted;
    supportRejected += optimized.supportRejected;
    if (isBetterFinalOffer(optimized.offer, best, context)) best = optimized.offer;

    // Keep checking a few more anchors if the current accepted offer is still too
    // CPU-lean or low-value. This prevents early weak comfortable offers from
    // hiding a stronger Aaron Gordon / Anthony Edwards type core.
    const margin = Number(optimized.offer?.comfortMargin || 0);
    const floor = Number(context.comfortFloor || TRADE_FINDER_COMFORT_FLOOR);
    const stopBuffer = profile.star ? 2.75 : profile.strong ? 2.0 : profile.normal ? 1.35 : 1.0;
    const goodEnoughNearFloor = margin <= floor + stopBuffer;
    const starAnchor = playerOvrOf(anchor) >= 88;
    if (goodEnoughNearFloor) {
      // Once a high-priority anchor produces a strong exact-accepted offer close
      // to the comfort range, do not keep hunting weaker anchors.
      break;
    }
    if (!profile.star && acceptedCores >= 4) break;
    if (profile.star && acceptedCores >= 5) break;
  }

  const teamMs = nowMs() - teamStartedAt;
  const metricDelta = diffMetrics(context.metrics, beforeMetrics);
  const exactEvals = Number(metricDelta.exactEvaluations || 0);
  const scanEvals = Number(metricDelta.scanEvaluations || 0);
  const stats = {
    teamIndex,
    teamMs: round1(teamMs),
    timing: roundTimingMap(teamTiming),
    metrics: cloneMetrics(metricDelta),
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
    const valueDiff = Number(b.offerValue || 0) - Number(a.offerValue || 0);
    if (Math.abs(valueDiff) > 0.5) return valueDiff;
    const marginA = Number(a.comfortMargin || 0);
    const marginB = Number(b.comfortMargin || 0);
    const floorA = Number(a.searchStats?.comfortFloor ?? TRADE_FINDER_COMFORT_FLOOR);
    const floorB = Number(b.searchStats?.comfortFloor ?? TRADE_FINDER_COMFORT_FLOOR);
    return Math.abs(marginA - floorA) - Math.abs(marginB - floorB);
  });
}


export async function runTradeFinderTeamBatch({
  leagueData,
  selectedTeam,
  selectedItems = [],
  cpuTeams = [],
  teamIndices = [],
  teamsToCheck = 0,
  comfortFloor = null,
  searchMode = "accurate",
  onTeamDone = null,
  signal = null,
} = {}) {
  const batchStartedAt = nowMs();
  const batchTiming = {};
  const baseContext = makeTradeFinderEvalContext({ leagueData, selectedTeam, selectedItems, comfortFloor });
  const offers = [];
  const teamSummaries = [];
  const aggregateMetrics = cloneMetrics(baseContext.metrics);

  for (let localIndex = 0; localIndex < cpuTeams.length; localIndex += 1) {
    if (isCancelled(signal)) break;
    const cpuTeam = cpuTeams[localIndex];
    const teamIndex = Number(teamIndices?.[localIndex] || localIndex + 1);
    const teamStart = nowMs();
    let phaseStartedAt = nowMs();
    const context = makeTradeFinderEvalContext({
      leagueData,
      selectedTeam,
      selectedItems,
      comfortFloor: baseContext.comfortFloor,
    });
    addTimingMs(batchTiming, "makeTeamContextMs", nowMs() - phaseStartedAt);
    const beforeMetrics = cloneMetrics(context.metrics);
    phaseStartedAt = nowMs();
    const offer = await findBestOfferForTeam({
      context,
      cpuTeam,
      teamIndex,
      teamsToCheck,
      onProgress: null,
      signal,
    });
    addTimingMs(batchTiming, "findBestOfferForTeamMs", nowMs() - phaseStartedAt);

    if (offer) offers.push(offer);

    const teamMs = nowMs() - teamStart;
    const metricDelta = diffMetrics(context.metrics, beforeMetrics);
    const evaluationsForTeam = Number(metricDelta.exactEvaluations || 0) + Number(metricDelta.scanEvaluations || 0);
    const summary = {
      teamIndex,
      team: getTeamName(cpuTeam),
      foundOffer: Boolean(offer),
      teamMs: round1(teamMs),
      evaluationsForTeam,
      offer: makeOfferDebugSummary(offer),
      stats: offer?.searchStats || null,
      timing: offer?.searchStats?.timing || null,
      metrics: cloneMetrics(metricDelta),
    };
    teamSummaries.push(summary);
    for (const [metricKey, metricValue] of Object.entries(context.metrics || {})) {
      aggregateMetrics[metricKey] = Number(aggregateMetrics[metricKey] || 0) + Number(metricValue || 0);
    }

    try {
      if (typeof onTeamDone === "function") onTeamDone(summary);
    } catch {}
  }

  batchTiming.totalMeasuredMs = nowMs() - batchStartedAt;
  return {
    offers,
    teamSummaries,
    metrics: cloneMetrics(aggregateMetrics),
    timing: roundTimingMap(batchTiming),
    elapsedMs: round1(nowMs() - batchStartedAt),
    searchMode,
  };
}

function mergeMetricTotals(target = {}, source = {}) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = Number(target[key] || 0) + Number(value || 0);
  }
  return target;
}

async function runTradeFinderTeamsInWorkerPool({
  leagueData,
  selectedTeam,
  selectedItems = [],
  checkTeams = [],
  baseComfortFloor = null,
  searchMode = "accurate",
  onProgress = null,
  signal = null,
  startedAt = nowMs(),
} = {}) {
  const workerCount = getTradeFinderWorkerPoolSize(checkTeams.length);
  if (!workerCount) return null;

  const chunks = chunkTeamsRoundRobin(checkTeams, workerCount);
  const workerStartedAt = nowMs();
  let completedTeams = 0;
  let offersFound = 0;
  const workers = [];
  let abortHandler = null;

  const terminateAll = () => {
    for (const worker of workers) {
      try {
        worker.terminate();
      } catch {}
    }
  };

  try {
    safeProgress(onProgress, {
      phase: "worker_pool_start",
      team: "",
      teamIndex: 0,
      teamsToCheck: checkTeams.length,
      offersFound: 0,
      elapsedSec: round1((nowMs() - startedAt) / 1000),
      workerCount: chunks.length,
      searchMode,
      searchProfile: "v12_builder_exact_best_player_anchor_worker_pool",
    });

    if (signal) {
      abortHandler = () => terminateAll();
      signal.addEventListener?.("abort", abortHandler, { once: true });
    }

    const runChunk = (chunk, workerId) =>
      new Promise((resolve, reject) => {
        if (isCancelled(signal)) return resolve({ offers: [], teamSummaries: [], metrics: {}, timing: {}, stopped: true });
        const worker = new Worker(new URL("../workers/tradeFinderTeamWorker.js", import.meta.url), { type: "module" });
        workers.push(worker);
        worker.onerror = (event) => {
          reject(new Error(event?.message || `Trade Finder worker ${workerId} failed`));
        };
        worker.onmessage = (event) => {
          const message = event?.data || {};
          if (message.type === "team_done") {
            completedTeams += 1;
            if (message.summary?.foundOffer) offersFound += 1;
            safeProgress(onProgress, {
              phase: "team_done",
              team: message.summary?.team || "",
              teamIndex: Number(message.summary?.teamIndex || completedTeams),
              teamsToCheck: checkTeams.length,
              offersFound,
              elapsedSec: round1((nowMs() - startedAt) / 1000),
              teamMs: Number(message.summary?.teamMs || 0),
              evaluationsForTeam: Number(message.summary?.evaluationsForTeam || 0),
              workerId,
              workerCount: chunks.length,
            });
            return;
          }
          if (message.type === "complete") {
            try {
              worker.terminate();
            } catch {}
            resolve(message.result || { offers: [], teamSummaries: [], metrics: {}, timing: {} });
            return;
          }
          if (message.type === "error") {
            reject(new Error(message.error?.message || message.error || `Trade Finder worker ${workerId} error`));
          }
        };
        worker.postMessage({
          type: "run_batch",
          workerId,
          payload: {
            leagueData,
            selectedTeam,
            selectedItems,
            cpuTeams: chunk.teams,
            teamIndices: chunk.teamIndices,
            teamsToCheck: checkTeams.length,
            comfortFloor: baseComfortFloor,
            searchMode,
          },
        });
      });

    const results = await Promise.all(chunks.map((chunk, index) => runChunk(chunk, index + 1)));
    const merged = {
      offers: [],
      teamSummaries: [],
      metrics: {},
      timing: {
        workerPoolMs: nowMs() - workerStartedAt,
        workerCount: chunks.length,
      },
      workerResults: results,
    };

    for (const result of results) {
      merged.offers.push(...(result.offers || []));
      merged.teamSummaries.push(...(result.teamSummaries || []));
      mergeMetricTotals(merged.metrics, result.metrics || {});
      for (const [key, value] of Object.entries(result.timing || {})) {
        if (key === "totalMeasuredMs") merged.timing.workerTotalMeasuredMs = Number(merged.timing.workerTotalMeasuredMs || 0) + Number(value || 0);
        else if (typeof value === "number") merged.timing[`worker_${key}`] = Number(merged.timing[`worker_${key}`] || 0) + Number(value || 0);
      }
    }
    merged.offers.sort((a, b) => Number(a?.searchStats?.teamIndex || 0) - Number(b?.searchStats?.teamIndex || 0));
    merged.teamSummaries.sort((a, b) => Number(a.teamIndex || 0) - Number(b.teamIndex || 0));
    merged.timing = roundTimingMap(merged.timing);
    return merged;
  } finally {
    if (signal && abortHandler) signal.removeEventListener?.("abort", abortHandler);
    terminateAll();
  }
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
  const searchTiming = {};
  let phaseStartedAt = nowMs();
  const allTeams = teams?.length ? teams : getAllTeamsFromLeagueData(leagueData);
  const checkTeams = allTeams.filter((team) => !sameTeamName(getTeamName(team), getTeamName(selectedTeam)));
  addTimingMs(searchTiming, "resolveTeamsMs", nowMs() - phaseStartedAt);
  phaseStartedAt = nowMs();
  const baseContext = makeTradeFinderEvalContext({ leagueData, selectedTeam, selectedItems });
  addTimingMs(searchTiming, "makeBaseContextMs", nowMs() - phaseStartedAt);
  const offers = [];
  const teamSummaries = [];
  const aggregateMetrics = cloneMetrics(baseContext.metrics);

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

  // Patch 2 speed safety: clear impact/rating caches once per full search, not
  // before every CPU team. The cache keys include roster/package/evaluation mode,
  // so this preserves exact outputs while allowing repeated selected-team and
  // league-power calculations to be reused across all 29 team searches.
  phaseStartedAt = nowMs();
  try {
    resetTradeFinderImpactSearchCaches({ keepPowerContext: true });
  } catch {}
  addTimingMs(searchTiming, "resetImpactCachesMs", nowMs() - phaseStartedAt);

  let usedWorkerPool = false;
  phaseStartedAt = nowMs();
  try {
    const workerResult = await runTradeFinderTeamsInWorkerPool({
      leagueData,
      selectedTeam,
      selectedItems,
      checkTeams,
      baseComfortFloor: baseContext.comfortFloor,
      searchMode,
      onProgress,
      signal,
      startedAt,
    });
    addTimingMs(searchTiming, "workerPoolDispatchMs", nowMs() - phaseStartedAt);
    if (workerResult) {
      usedWorkerPool = true;
      offers.push(...(workerResult.offers || []));
      teamSummaries.push(...(workerResult.teamSummaries || []));
      for (const key of Object.keys(aggregateMetrics)) aggregateMetrics[key] = 0;
      mergeMetricTotals(aggregateMetrics, workerResult.metrics || {});
      for (const [timingKey, timingValue] of Object.entries(workerResult.timing || {})) {
        searchTiming[timingKey] = Number(searchTiming[timingKey] || 0) + Number(timingValue || 0);
      }
    }
  } catch (error) {
    addTimingMs(searchTiming, "workerPoolDispatchMs", nowMs() - phaseStartedAt);
    console.warn("[TF WORKER] Worker pool failed; falling back to serial Trade Finder search.", error);
    usedWorkerPool = false;
    offers.length = 0;
    teamSummaries.length = 0;
    for (const key of Object.keys(aggregateMetrics)) aggregateMetrics[key] = Number(baseContext.metrics?.[key] || 0);
  }

  if (!usedWorkerPool) {
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

    const teamStart = nowMs();
    phaseStartedAt = nowMs();
    const context = makeTradeFinderEvalContext({
      leagueData,
      selectedTeam,
      selectedItems,
      comfortFloor: baseContext.comfortFloor,
    });
    addTimingMs(searchTiming, "makeTeamContextMs", nowMs() - phaseStartedAt);
    const beforeMetrics = cloneMetrics(context.metrics);
    phaseStartedAt = nowMs();
    const offer = await findBestOfferForTeam({
      context,
      cpuTeam,
      teamIndex: index + 1,
      teamsToCheck: checkTeams.length,
      onProgress: (progress) =>
        safeProgress(onProgress, { ...progress, offersFound: offers.length, elapsedSec: round1((nowMs() - startedAt) / 1000) }),
      signal,
    });
    addTimingMs(searchTiming, "findBestOfferForTeamMs", nowMs() - phaseStartedAt);

    if (offer) offers.push(offer);

    const teamMs = nowMs() - teamStart;
    const metricDelta = diffMetrics(context.metrics, beforeMetrics);
    const evaluationsForTeam = Number(metricDelta.exactEvaluations || 0) + Number(metricDelta.scanEvaluations || 0);
    const summary = {
      team: getTeamName(cpuTeam),
      foundOffer: Boolean(offer),
      teamMs: round1(teamMs),
      evaluationsForTeam,
      offer: makeOfferDebugSummary(offer),
      stats: offer?.searchStats || null,
      timing: offer?.searchStats?.timing || null,
      metrics: cloneMetrics(metricDelta),
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

  }

  phaseStartedAt = nowMs();
  const finalOffers = sortFinalOffers(offers).map((offer) => ({ ...offer, offer: sortTradeFinderOfferItems(offer.offer, leagueData) }));
  addTimingMs(searchTiming, "sortFinalOffersMs", nowMs() - phaseStartedAt);
  const elapsedSec = round1((nowMs() - startedAt) / 1000);
  searchTiming.totalMeasuredMs = nowMs() - startedAt;
  const stopped = isCancelled(signal);
  const debugPayload = {
    engine: "v12_builder_exact_best_player_anchor",
    policy:
      "builder-exact best-player anchor optimizer; displayed offers use same score as Propose Trade; support picks added only after accepted player core; rejected support is downgraded/removed",
    comfortFloor: baseContext.comfortFloor,
    selectedTeam: getTeamName(selectedTeam),
    selectedAssets: selectedItems.length,
    workerPoolEnabled: usedWorkerPool,
    workerPoolSize: usedWorkerPool ? getTradeFinderWorkerPoolSize(checkTeams.length) : 0,
    teamsChecked: checkTeams.length,
    offersFound: finalOffers.length,
    elapsedSec,
    selectedValue: round1(packageValue(selectedItems, leagueData)),
    metrics: cloneMetrics(aggregateMetrics),
    timing: roundTimingMap(searchTiming),
    offers: finalOffers.map(makeOfferDebugSummary),
    teamSummaries,
  };
  debugPayload.baselineSnapshot = makeTradeFinderBaselineSnapshot(debugPayload);

  try {
    if (typeof window !== "undefined") {
      window.__TF_LAST_DEBUG = debugPayload;
      window.__TF_LAST_SNAPSHOT = debugPayload.baselineSnapshot;
      installTradeFinderBaselineTools(debugPayload);
    }
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
