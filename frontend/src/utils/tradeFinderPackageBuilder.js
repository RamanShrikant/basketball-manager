import { filterTradeEligiblePlayers } from "./tradeRosterEligibility.js";
import { getPlayerSalary, sideSalary } from "./tradeExecution.js";
import {
  canAddCustomProtectionToPick,
  getTradePickBaseProtectionLabel,
  getTradeablePickOwnedRange,
  isResolvedDraftPickAsset,
  isSwapDraftPickAsset,
  normalizeDraftPicks,
  normalizeTeamName,
  sortDraftPickAssets,
  validateCustomPickProtection,
} from "./draftPicks.js";

export const TRADE_FINDER_MAX_SIDE_ITEMS = 8;
export const TRADE_FINDER_DEFAULT_PICK_PROTECTION = "Unprotected";

function safeJSON(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function getAllTeamsFromLeagueData(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

export function getTeamName(team = {}) {
  return team?.name || team?.teamName || "";
}

export function sameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

export function getTeamPlayers(team = {}) {
  return Array.isArray(team?.players) ? team.players : [];
}

export function playerNameOf(player = {}) {
  return player?.name || player?.player || "Unknown Player";
}

export function playerKey(player = {}) {
  return String(player.id ?? player.playerId ?? player.uuid ?? player.name ?? playerNameOf(player));
}

export function pickKey(pick = {}) {
  const rule = pick.tradeRule || {};
  if (rule.swapId) return `swap:${rule.swapId}:${rule.mirror ? "mirror" : "primary"}`;
  return String(
    pick.id ||
      pick.pickId ||
      `${pick.assetType || pick.type || "pick"}:${pick.year || ""}:${pick.round || ""}:${pick.originalTeam || pick.originalTeamName || ""}:${pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || ""}:${getTradePickBaseProtectionLabel(pick)}`
  );
}

export function itemKey(item = {}) {
  if (item.type === "player") return `player:${playerKey(item.player)}`;
  if (item.type === "pick") {
    const pick = item.pick || {};
    const rule = item.tradeRule || pick.tradeRule || {};
    if (rule.swapId) return `swap:${rule.swapId}:${rule.mirror ? "mirror" : "primary"}`;
    return `pick:${pickKey(pick)}:${item.protection || pick.protection || ""}:${rule.action || ""}:${rule.protectStart || ""}:${rule.protectEnd || ""}`;
  }
  return `${item.type}:${JSON.stringify(item)}`;
}

export function packageKey(items = []) {
  return (items || []).map(itemKey).sort().join("||");
}

export function itemFamilyKey(item = {}) {
  if (item.type === "player") return `player:${playerKey(item.player)}`;
  if (item.type === "pick") {
    const pick = item.pick || {};
    const rule = item.tradeRule || pick.tradeRule || {};
    if (rule.swapId) return `swap:${rule.swapId}`;
    return `pick:${pick.id || pick.pickId || `${pick.assetType || pick.type || "pick"}:${pick.year || ""}:${pick.round || ""}:${pick.originalTeam || pick.originalTeamName || ""}:${pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || ""}`}`;
  }
  return itemKey(item);
}

export function uniqueByItemKey(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = itemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function uniqueByFamilyKey(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = itemFamilyKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function isStandardRosterPlayer(player = {}) {
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

export function getSeasonYearFromLeague(leagueData = {}) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      leagueData?.calendar?.seasonYear ||
      2026
  );
}

function readLockedDraftOrder(leagueData, seasonYear) {
  const attachedContext = leagueData?.__offseasonTradeContext;
  const attached = attachedContext?.draftOrder;
  if (attachedContext?.draftOrderLocked && Array.isArray(attached) && attached.length) return attached;
  const lotteryComplete = Boolean(
    leagueData?.draftState?.draftLotteryComplete ||
      leagueData?.offseasonState?.draftLotteryComplete
  );
  const direct = leagueData?.draftState?.fullDraftOrder || leagueData?.draftLottery?.fullDraftOrder;
  if (lotteryComplete && Array.isArray(direct) && direct.length) return direct;
  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (lotteryComplete && Array.isArray(lotteryOrder) && lotteryOrder.length) return lotteryOrder;

  try {
    if (typeof localStorage === "undefined") return [];
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
  } catch {}

  return [];
}

function isDraftCompleteForSeason(leagueData, seasonYear) {
  const attached = leagueData?.__offseasonTradeContext;
  if (attached && Number(attached.seasonYear || seasonYear) === Number(seasonYear)) {
    return Boolean(attached.draftComplete);
  }
  try {
    const offseasonState = typeof localStorage !== "undefined" ? safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {} : {};
    const savedDraftState = typeof localStorage !== "undefined" ? safeJSON(localStorage.getItem("bm_draft_state_v1"), null) : null;
    return Boolean(
      (Number(offseasonState?.seasonYear || seasonYear) === Number(seasonYear) && offseasonState?.draftComplete) ||
        (Number(savedDraftState?.seasonYear || 0) === Number(seasonYear) && savedDraftState?.completed) ||
        (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed)
    );
  } catch {
    return Boolean(Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed);
  }
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

export function collectTradeablePicksForTeam(leagueData, teamName) {
  if (!leagueData || !teamName) return [];
  const teamNames = getAllTeamsFromLeagueData(leagueData)
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
    .map((pick) => ({ ...pick, currentSeasonYear: seasonYear, leagueSeasonYear: seasonYear }));

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

export function pickProtectionLabel(pick = {}) {
  const label = String(getTradePickBaseProtectionLabel(pick) || pick?.protection || pick?.protections || pick?.displayProtection || "").trim();
  if (!label || label.toLowerCase() === "none" || label.toLowerCase() === "null") return TRADE_FINDER_DEFAULT_PICK_PROTECTION;
  return label;
}

export function formatPick(pick = {}) {
  const round = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "Own";
  const pickNumber = Number(pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || pick?.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${pick?.year || "Future"} ${round}${pickText} - ${original}`;
}

export function playerValue(player, leagueData) {
  const overall = Number(player?.overall || player?.ovr || 0);
  const potential = Number(player?.potential || player?.pot || overall || 0);
  const age = Number(player?.age || 27);
  const salaryM = getPlayerSalary(player, leagueData) / 1_000_000;

  // One consistent scale for every Trade Finder search. The old linear formula
  // made cheap 76-78 OVR players worth almost as much as franchise players, which
  // caused normal packages to search like superstar packages. This curve keeps
  // stars expensive while making rotation-player packages land in a realistic
  // target range.
  const lowTier = Math.max(0, Math.min(overall, 80) - 60) * 1.25;
  const starterTier = Math.max(0, Math.min(overall, 85) - 80) * 2.0;
  const starTier = Math.max(0, overall - 85) * 4.0;
  const ratingValue = Math.max(2, lowTier + starterTier + starTier);
  const potentialBonus = Math.max(-8, potential - overall) * 1.15;
  const ageBonus = age <= 22 ? 8 : age <= 25 ? 6 : age <= 28 ? 3.5 : age <= 31 ? 1 : age <= 34 ? -2 : -6;
  const contractPenalty = Math.max(0, salaryM - 18) * 0.40;
  const bargainBonus = overall >= 76 && salaryM > 0 && salaryM <= 8 ? 4.5 : 0;
  const starBonus = overall >= 95 ? 42 : overall >= 92 ? 34 : overall >= 90 ? 26 : overall >= 85 ? 12 : overall >= 80 ? 4 : 0;

  return Math.max(1, ratingValue + potentialBonus + ageBonus + starBonus + bargainBonus - contractPenalty);
}

export function pickValue(pick, protection = TRADE_FINDER_DEFAULT_PICK_PROTECTION, leagueData = null) {
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
  const protectionText = String(exactPick ? TRADE_FINDER_DEFAULT_PICK_PROTECTION : protection || TRADE_FINDER_DEFAULT_PICK_PROTECTION).toLowerCase();

  let base = round === 1 ? Math.max(6, 38 - projectedRank * 0.85) : Math.max(1, 7 - projectedRank * 0.08);
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

export function assetValue(asset, leagueData) {
  if (asset?.type === "player") return playerValue(asset.player, leagueData);
  if (asset?.type === "pick") return pickValue(asset.pick, asset.protection, leagueData) + Number(asset.valueAdjust || 0);
  return 0;
}

export function packageValue(items = [], leagueData = null) {
  return (items || []).reduce((sum, item) => sum + assetValue(item, leagueData), 0);
}

function buildFullPickTradeRule(pick) {
  return {
    action: "full",
    ownedRange: getTradeablePickOwnedRange(pick),
    source: isSwapDraftPickAsset(pick) ? "trade_finder_existing_swap" : "trade_finder_offer_engine_v3",
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
    source: "trade_finder_offer_engine_v3",
  };
  return buildPickItem(pick, validation.baseProtectionLabel, tradeRule, -0.8);
}

function getProtectionEndsForPick(pick = {}) {
  const owned = getTradeablePickOwnedRange(pick);
  const candidates = Number(pick.round || 1) === 1 ? [20, 14, 10, 5, 3] : [50, 45];
  return candidates
    .map((value) => Math.max(Number(owned.start || 1), Math.min(Number(owned.end || 30) - 1, Number(value))))
    .filter((value, index, arr) => Number.isFinite(value) && value >= Number(owned.start || 1) && value < Number(owned.end || 30) && arr.indexOf(value) === index);
}

function isAlreadyExistingSwapPick(pick = {}) {
  if (!isSwapDraftPickAsset(pick)) return false;
  const generated = pick?.realLifeDetails?.tradeGenerated || pick?.logicType === "trade_machine_swap" || pick?.source === "Trade Machine";
  return !generated || Boolean(pick.id || pick.pickId);
}

export function buildPickCandidates(team, leagueData) {
  const teamName = getTeamName(team);
  const rows = collectTradeablePicksForTeam(leagueData, teamName);
  const variants = [];

  for (const pick of rows) {
    const baseProtection = pickProtectionLabel(pick);
    if (isSwapDraftPickAsset(pick) && !isAlreadyExistingSwapPick(pick)) continue;

    variants.push(buildPickItem(pick, baseProtection, buildFullPickTradeRule(pick)));

    // Trade Finder is trying to return the strongest comfortable CPU offer.
    // Do not invent softer custom protections here; if a pick is already
    // protected in leagueData we respect it, but an owned unprotected pick should
    // stay unprotected instead of appearing as a conservative Top-3/Top-5 offer.
  }

  // Keep all variants available for fallback exploration, but expose a strong-first
  // order. This prevents the finder from getting stuck on protected picks when the
  // CPU still comfortably accepts unprotected versions.
  const seen = new Set();
  return variants
    .map((item) => ({
      ...item,
      value: assetValue(item, leagueData),
      balanceAsset: true,
    }))
    .sort((a, b) => {
      const roundDiff = Number(a.pick?.round || 1) - Number(b.pick?.round || 1);
      if (roundDiff) return roundDiff;
      const valDiff = Number(b.value || 0) - Number(a.value || 0);
      if (valDiff) return valDiff;
      return Number(a.pick?.year || 9999) - Number(b.pick?.year || 9999);
    })
    .filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildPlayerCandidates(team, leagueData) {
  return filterTradeEligiblePlayers(getTeamPlayers(team), { leagueData })
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
    .sort((a, b) => {
      const valueDiff = Number(b.value || 0) - Number(a.value || 0);
      if (valueDiff) return valueDiff;
      return Number(b.salary || 0) - Number(a.salary || 0);
    });
}

export function buildAssetBoard(cpuTeam, leagueData) {
  const players = buildPlayerCandidates(cpuTeam, leagueData);
  const picks = buildPickCandidates(cpuTeam, leagueData);
  const highValuePlayers = players.slice().sort((a, b) => b.value - a.value);
  const salaryPlayers = players.slice().sort((a, b) => b.salary - a.salary || b.value - a.value);
  const efficientPlayers = players.slice().sort((a, b) => b.salaryValueRatio - a.salaryValueRatio || b.value - a.value);
  const fillerPlayers = players.slice().sort((a, b) => a.value - b.value || b.salary - a.salary);
  const firsts = picks.filter((item) => Number(item?.pick?.round || 1) === 1).sort((a, b) => b.value - a.value);
  const seconds = picks.filter((item) => Number(item?.pick?.round || 1) !== 1).sort((a, b) => b.value - a.value);
  return {
    players,
    picks,
    highValuePlayers,
    salaryPlayers,
    efficientPlayers,
    fillerPlayers,
    firsts,
    seconds,
    allAssets: uniqueByItemKey([...highValuePlayers, ...firsts, ...seconds]),
  };
}

function addPackage(packageMap, items = []) {
  const cleaned = uniqueByFamilyKey((items || []).filter(Boolean)).slice(0, TRADE_FINDER_MAX_SIDE_ITEMS);
  if (!cleaned.length) return;
  const key = packageKey(cleaned);
  if (!packageMap.has(key)) packageMap.set(key, cleaned);
}

function packageSalary(items = [], leagueData = null) {
  return sideSalary(items, leagueData);
}

function salaryGapScore(items = [], targetSalary = 0, leagueData = null) {
  const salary = packageSalary(items, leagueData);
  const target = Number(targetSalary || 0);
  if (target <= 0) return Math.abs(salary) / 1_000_000;
  return Math.abs(salary - target) / 1_000_000;
}

function buildGreedyFillPackage(seedItems, fillPool, { selectedSalary = 0, leagueData = null, maxPlayers = 4 } = {}) {
  const pkg = uniqueByFamilyKey(seedItems || []);
  const used = new Set(pkg.map(itemFamilyKey));
  const selectedSalaryTarget = Number(selectedSalary || 0) * 0.82;

  for (const player of fillPool || []) {
    if (pkg.length >= Math.min(TRADE_FINDER_MAX_SIDE_ITEMS, maxPlayers)) break;
    if (used.has(itemFamilyKey(player))) continue;
    const salaryNow = packageSalary(pkg, leagueData);
    if (selectedSalaryTarget > 0 && salaryNow >= selectedSalaryTarget && pkg.length >= 2) break;
    pkg.push(player);
    used.add(itemFamilyKey(player));
  }
  return pkg;
}

function topUniqueAssets(...groups) {
  return uniqueByItemKey(groups.flat().filter(Boolean));
}

export function buildTradeFinderCandidatePackages({
  board,
  leagueData,
  selectedItems = [],
  selectedTeam = null,
  cpuTeam = null,
  financialOk = null,
  maxPackages = 96,
} = {}) {
  const packageMap = new Map();
  const selectedValue = packageValue(selectedItems, leagueData);
  const selectedSalary = sideSalary(selectedItems, leagueData);
  const players = board?.players || [];
  const picks = board?.picks || [];
  const highValue = board?.highValuePlayers || players;
  const salaryPlayers = board?.salaryPlayers || players;
  const efficient = board?.efficientPlayers || players;
  const filler = board?.fillerPlayers || players;
  const firsts = board?.firsts || picks.filter((item) => Number(item?.pick?.round || 1) === 1);
  const seconds = board?.seconds || [];

  const anchorPool = topUniqueAssets(
    highValue.slice(0, 10),
    salaryPlayers.slice(0, 8),
    efficient.slice(0, 5),
    filler.slice(0, 4)
  ).slice(0, 16);

  // 1) Every team starts with simple player shells, regardless of selected asset type.
  for (const player of anchorPool) addPackage(packageMap, [player]);

  // 2) Force multi-player salary shells. This is the coverage fix for teams that
  // do not have one giant contract but can legally aggregate 2-4 players.
  for (const anchor of anchorPool.slice(0, 12)) {
    addPackage(packageMap, buildGreedyFillPackage([anchor], salaryPlayers, { selectedSalary, leagueData, maxPlayers: 4 }));
    addPackage(packageMap, buildGreedyFillPackage([anchor], highValue, { selectedSalary, leagueData, maxPlayers: 4 }));
    addPackage(packageMap, buildGreedyFillPackage([anchor], filler, { selectedSalary, leagueData, maxPlayers: 4 }));

    // Mid-salary aggregation is critical for teams that can make legal offers
    // without one giant contract. Do not force the highest-value star into every
    // shell; let an anchor combine with realistic salary pieces.
    const midSalaryPool = salaryPlayers
      .filter((asset) => itemFamilyKey(asset) !== itemFamilyKey(anchor))
      .filter((asset) => Number(asset.salary || 0) >= 8_000_000)
      .filter((asset) => Number(asset.value || 0) <= Number(anchor.value || 0) + 4)
      .sort((a, b) => Number(b.salary || 0) - Number(a.salary || 0) || Number(b.value || 0) - Number(a.value || 0));
    addPackage(packageMap, buildGreedyFillPackage([anchor], midSalaryPool, { selectedSalary, leagueData, maxPlayers: 4 }));
  }

  // 3) Pair families: value anchor + salary/contract filler, veteran salary + young asset,
  // efficient young piece + salary. These are deliberately consistent for all trade types.
  const pairA = topUniqueAssets(highValue.slice(0, 10), salaryPlayers.slice(0, 8));
  const pairB = topUniqueAssets(salaryPlayers.slice(0, 10), efficient.slice(0, 8), filler.slice(0, 6));
  for (const a of pairA) {
    for (const b of pairB) {
      if (itemFamilyKey(a) === itemFamilyKey(b)) continue;
      const pair = uniqueByFamilyKey([a, b]);
      addPackage(packageMap, pair);
      if (selectedSalary > 12_000_000) {
        addPackage(packageMap, buildGreedyFillPackage(pair, salaryPlayers, { selectedSalary, leagueData, maxPlayers: 4 }));
        addPackage(packageMap, buildGreedyFillPackage(pair, filler, { selectedSalary, leagueData, maxPlayers: 4 }));
      }
    }
  }

  // 4) Pick-first and pick-bridge shells are always available. For zero/low salary
  // offers, these let most teams answer with picks. For salary trades, they attach
  // only after a player shell is present.
  const topPicks = topUniqueAssets(firsts.slice(0, 8), seconds.slice(0, 4)).slice(0, 10);
  for (const pick of topPicks) addPackage(packageMap, [pick]);
  for (const playerShell of [...packageMap.values()].filter((pkg) => pkg.some((item) => item.type === "player")).slice(0, 90)) {
    const used = new Set(playerShell.map(itemFamilyKey));
    const bridge = [...playerShell];
    for (const pick of topPicks) {
      if (bridge.length >= TRADE_FINDER_MAX_SIDE_ITEMS) break;
      if (used.has(itemFamilyKey(pick))) continue;
      bridge.push(pick);
      used.add(itemFamilyKey(pick));
      addPackage(packageMap, bridge.slice());
      // Do not stop at a rough value target. The engine maximizes exact-accepted
      // value, so keep the ladder alive until the asset cap.
    }
  }

  const candidates = [...packageMap.values()]
    .filter((pkg) => pkg.length && pkg.length <= TRADE_FINDER_MAX_SIDE_ITEMS)
    .map((pkg) => ({
      items: uniqueByFamilyKey(pkg),
      value: packageValue(pkg, leagueData),
      salary: packageSalary(pkg, leagueData),
    }))
    .filter((row) => row.items.length && row.items.length <= TRADE_FINDER_MAX_SIDE_ITEMS)
    .sort((a, b) => {
      // Stronger packages first, but do not ignore salary coverage. This is only a
      // candidate order; exact CPU acceptance remains the source of truth.
      // Do not call financial legality inside the sort comparator. That made one
      // search create tens of thousands of cached salary checks and was a major
      // reason Trade Finder slowed down across the league. The offer engine
      // filters legality once per candidate before exact evaluation.
      const aSalaryGap = salaryGapScore(a.items, selectedSalary, leagueData);
      const bSalaryGap = salaryGapScore(b.items, selectedSalary, leagueData);
      const aScore = -a.value + aSalaryGap * 0.42 + a.items.length * 0.28;
      const bScore = -b.value + bSalaryGap * 0.42 + b.items.length * 0.28;
      return aScore - bScore;
    });

  const seen = new Set();
  const out = [];
  for (const row of candidates) {
    const key = packageKey(row.items);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.items);
    if (out.length >= maxPackages) break;
  }
  return out;
}

export function getUpgradeAssets(board, currentItems = [], leagueData = null) {
  const usedFamilies = new Set((currentItems || []).map(itemFamilyKey));
  const currentPickFamilies = new Set((currentItems || []).filter((item) => item.type === "pick").map(itemFamilyKey));
  const playerAdds = (board?.highValuePlayers || [])
    .filter((item) => !usedFamilies.has(itemFamilyKey(item)))
    .slice(0, 14);
  const pickAdds = (board?.picks || [])
    .filter((item) => !usedFamilies.has(itemFamilyKey(item)))
    .slice(0, 18);

  // Replacement upgrades: if a package somehow contains a protected version of a
  // pick, put the better version of the same family in the upgrade lane.
  const replacements = [];
  for (const item of currentItems || []) {
    if (item?.type !== "pick") continue;
    const family = itemFamilyKey(item);
    const better = (board?.picks || [])
      .filter((candidate) => itemFamilyKey(candidate) === family)
      .sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData))[0];
    if (better && itemKey(better) !== itemKey(item) && assetValue(better, leagueData) > assetValue(item, leagueData)) {
      replacements.push({ replaceFamily: family, asset: better });
    }
  }

  return {
    additions: topUniqueAssets(playerAdds, pickAdds).sort((a, b) => assetValue(b, leagueData) - assetValue(a, leagueData)),
    replacements,
    usedPickFamilies: currentPickFamilies,
  };
}

export function sortTradeFinderOfferItems(items = [], leagueData = null) {
  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => {
    const aIsPlayer = a?.type === "player";
    const bIsPlayer = b?.type === "player";
    const aIsSwap = a?.type === "pick" && isSwapDraftPickAsset(a.pick || {});
    const bIsSwap = b?.type === "pick" && isSwapDraftPickAsset(b.pick || {});
    const aRound = Number(a?.pick?.round || 1);
    const bRound = Number(b?.pick?.round || 1);
    const groupOf = (isPlayer, isSwap, round) => {
      if (isPlayer) return 0;
      if (isSwap) return 3;
      return Number(round || 1) === 1 ? 1 : 2;
    };
    const groupA = groupOf(aIsPlayer, aIsSwap, aRound);
    const groupB = groupOf(bIsPlayer, bIsSwap, bRound);
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
      const yearDiff = Number(a.pick?.year || 9999) - Number(b.pick?.year || 9999);
      if (yearDiff) return yearDiff;
      const valueDiff = assetValue(b, leagueData) - assetValue(a, leagueData);
      if (valueDiff) return valueDiff;
      return String(a.label || "").localeCompare(String(b.label || ""));
    }

    return 0;
  });
}
