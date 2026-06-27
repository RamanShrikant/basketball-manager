import {
  canAddCustomProtectionToPick,
  canCreateSwapWithPick,
  getActiveSwapParticipantKeySet,
  getDefaultPickOwnedRange,
  getDraftPickAssetLabel,
  getDraftPickConflictKey,
  getTeamNamesFromLeague,
  getTradePickBaseProtectionLabel,
  getTradeablePickOwnedRange,
  isDraftPickEncumberedByActiveSwap,
  isResolvedDraftPickAsset,
  isSwapDraftPickAsset,
  normalizeDraftPickAsset,
  normalizeDraftPicks,
  normalizeTeamName,
  sortDraftPickAssets,
  validateCustomPickProtection,
} from "./draftPicks.js";
import { evaluateTradeTeamImpact } from "./tradeTeamImpact.js";
import {
  evaluateTradeFinancialLegality,
  getPlayerSalary,
  sideSalary,
} from "./tradeExecution.js";

const MAX_SIDE_ITEMS = 8;
const REGULAR_SEASON_MAX_STANDARD_PLAYERS = 16;
const EPS = 0.0001;
const PROTECTION_ENDS = [3, 5, 10, 14, 20];

const MODE_CONFIG = {
  instant: {
    label: "Instant",
    maxPlayers: 3,
    exactBudgetSingle: 8,
    exactBudgetAll: 34,
    exactPerOpponentAll: 1,
    exactPerOpponentSingle: 8,
    wallMsSingle: 2200,
    wallMsAll: 9000,
    maxResultsSingle: 5,
    maxResultsAll: 8,
    maxResultsPerOpponent: 2,
    maxCandidatesPerOpponent: 5,
    maxGlobalCandidates: 0,
    maxDraftAssetsSmall: 2,
    maxDraftAssetsMedium: 3,
    maxDraftAssetsBig: 5,
  },
  quick: {
    label: "Quick",
    maxPlayers: 4,
    exactBudgetSingle: 12,
    exactBudgetAll: 56,
    exactPerOpponentAll: 2,
    exactPerOpponentSingle: 12,
    wallMsSingle: 3400,
    wallMsAll: 12000,
    maxResultsSingle: 7,
    maxResultsAll: 10,
    maxResultsPerOpponent: 3,
    maxCandidatesPerOpponent: 7,
    maxGlobalCandidates: 0,
    maxDraftAssetsSmall: 2,
    maxDraftAssetsMedium: 4,
    maxDraftAssetsBig: 5,
  },
  normal: {
    label: "Normal",
    maxPlayers: 5,
    exactBudgetSingle: 16,
    exactBudgetAll: 74,
    exactPerOpponentAll: 3,
    exactPerOpponentSingle: 16,
    wallMsSingle: 5200,
    wallMsAll: 15000,
    maxResultsSingle: 9,
    maxResultsAll: 12,
    maxResultsPerOpponent: 4,
    maxCandidatesPerOpponent: 9,
    maxGlobalCandidates: 0,
    maxDraftAssetsSmall: 3,
    maxDraftAssetsMedium: 4,
    maxDraftAssetsBig: 5,
  },
};

const waitFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

function cleanDepth(value = "instant") {
  const key = String(value || "instant").toLowerCase();
  return key === "normal" || key === "quick" ? key : "instant";
}

function sameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function teamNameOf(team = {}) {
  return team?.name || team?.teamName || "";
}

function playerNameOf(player = {}) {
  return player?.name || player?.player || player?.playerName || "Unknown Player";
}

function playerKey(player = {}) {
  return String(player?.id || player?.playerId || player?.slug || playerNameOf(player)).toLowerCase();
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function findTeam(leagueData, name = "") {
  const target = normalizeTeamName(name);
  return getAllTeamsFromLeague(leagueData).find((team) => normalizeTeamName(teamNameOf(team)) === target) || null;
}

function getCurrentSeasonYear(leagueData = {}) {
  return Number(
    leagueData?.draftYear ||
      leagueData?.currentDraftYear ||
      leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

function isStandardTradePlayer(player = {}) {
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

function playerApproxValue(player = {}, leagueData = {}) {
  const ovr = Number(player.overall ?? player.ovr ?? 0) || 0;
  const pot = Number(player.potential ?? player.pot ?? ovr) || ovr;
  const age = Number(player.age ?? 27) || 27;
  const salary = getPlayerSalary(player, leagueData) || 0;
  const youth = age <= 22 ? 8 : age <= 25 ? 5 : age <= 28 ? 2 : age >= 34 ? -4 : 0;
  const star = ovr >= 94 ? 32 : ovr >= 90 ? 20 : ovr >= 86 ? 10 : ovr >= 82 ? 4 : 0;
  const badContract = salary > 25_000_000 && ovr < 82 ? (salary - 22_000_000) / 3_500_000 : 0;
  const minContractBump = salary <= 4_000_000 && ovr >= 74 ? 3 : 0;
  return ovr * 1.6 + pot * 0.58 + youth + star + minContractBump - badContract;
}

function enrichPlayer(player, leagueData) {
  const ovr = Number(player.overall ?? player.ovr ?? 0) || 0;
  const pot = Number(player.potential ?? player.pot ?? ovr) || ovr;
  const age = Number(player.age ?? 27) || 27;
  const salary = getPlayerSalary(player, leagueData) || 0;
  const approxValue = playerApproxValue(player, leagueData);
  return {
    player,
    key: playerKey(player),
    name: playerNameOf(player),
    ovr,
    pot,
    age,
    salary,
    approxValue,
    surplus: approxValue - salary / 1_200_000,
    badContractScore: salary / 1_000_000 - Math.max(0, ovr - 70) * 1.2,
  };
}

function uniqueByKey(rows = [], max = Infinity) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row?.key || playerKey(row?.player || row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

function buildTeamProfile(team = {}, leagueData = {}, mode = "instant") {
  const depth = cleanDepth(mode);
  const config = MODE_CONFIG[depth];
  const rows = (Array.isArray(team?.players) ? team.players : [])
    .filter(isStandardTradePlayer)
    .map((player) => enrichPlayer(player, leagueData));

  const byValue = [...rows].sort((a, b) => b.approxValue - a.approxValue || b.salary - a.salary);
  const bySalary = [...rows].sort((a, b) => b.salary - a.salary || b.approxValue - a.approxValue);
  const bySalaryAsc = [...rows].sort((a, b) => a.salary - b.salary || b.approxValue - a.approxValue);
  const young = rows.filter((p) => p.age <= 25).sort((a, b) => b.surplus - a.surplus || b.pot - a.pot);
  const vets = rows.filter((p) => p.age >= 28 && p.ovr >= 73).sort((a, b) => b.ovr - a.ovr || b.salary - a.salary);
  const stars = rows.filter((p) => p.ovr >= 88).sort((a, b) => b.ovr - a.ovr || b.pot - a.pot);
  const badContracts = rows.filter((p) => p.salary >= 12_000_000).sort((a, b) => b.badContractScore - a.badContractScore);
  const lowSalaryUseful = rows.filter((p) => p.salary <= 8_000_000).sort((a, b) => b.surplus - a.surplus || b.ovr - a.ovr);
  const bench = rows.filter((p) => p.ovr <= 78).sort((a, b) => b.salary - a.salary || b.ovr - a.ovr);

  const anchors = uniqueByKey([
    ...stars.slice(0, 4),
    ...byValue.slice(0, 7),
    ...bySalary.slice(0, 5),
    ...young.slice(0, 6),
    ...vets.slice(0, 5),
    ...badContracts.slice(0, 4),
    ...lowSalaryUseful.slice(0, 5),
    ...bench.slice(0, 5),
    ...rows,
  ], depth === "instant" ? 10 : depth === "quick" ? 13 : 16);

  return {
    team,
    name: teamNameOf(team),
    rows,
    byValue,
    bySalary,
    bySalaryAsc,
    young,
    vets,
    stars,
    badContracts,
    lowSalaryUseful,
    bench,
    anchors,
    maxPlayers: config.maxPlayers,
  };
}

function packageFromRows(teamName, rows = []) {
  const clean = uniqueByKey(rows).filter(Boolean);
  return {
    rows: clean,
    players: clean.map((row) => row.player),
    salary: clean.reduce((sum, row) => sum + Number(row.salary || 0), 0),
    value: clean.reduce((sum, row) => sum + Number(row.approxValue || 0), 0),
    ovrMax: clean.reduce((max, row) => Math.max(max, Number(row.ovr || 0)), 0),
    potMax: clean.reduce((max, row) => Math.max(max, Number(row.pot || 0)), 0),
    count: clean.length,
    key: clean.map((row) => row.key).sort().join("|"),
    items: clean.map((row) => ({ type: "player", teamName, player: row.player })),
  };
}

function addBestFillers({ profile, anchors = [], targetSalary = 0, maxPlayers = 3, prefer = "neutral" }) {
  const selected = uniqueByKey(anchors);
  const used = new Set(selected.map((row) => row.key));
  const target = Number(targetSalary || 0);
  const fillerPool = profile.rows
    .filter((row) => !used.has(row.key))
    .sort((a, b) => {
      const remainingA = Math.abs((target - selected.reduce((sum, row) => sum + Number(row.salary || 0), 0)) - Number(a.salary || 0));
      const remainingB = Math.abs((target - selected.reduce((sum, row) => sum + Number(row.salary || 0), 0)) - Number(b.salary || 0));
      if (prefer === "bad_contract") return b.badContractScore - a.badContractScore || remainingA - remainingB;
      if (prefer === "young") return b.surplus - a.surplus || remainingA - remainingB;
      if (prefer === "salary") return b.salary - a.salary || remainingA - remainingB;
      return remainingA - remainingB || Math.abs(b.salary - a.salary) || b.approxValue - a.approxValue;
    });

  while (selected.length < maxPlayers) {
    const currentSalary = selected.reduce((sum, row) => sum + Number(row.salary || 0), 0);
    if (currentSalary >= target * 0.92 && currentSalary >= target - 2_000_000) break;
    const next = fillerPool.find((row) => !used.has(row.key));
    if (!next) break;
    selected.push(next);
    used.add(next.key);
  }

  return packageFromRows(profile.name, selected);
}

function getFinancialOk(team, leagueData, outgoingSalary, incomingSalary) {
  return Boolean(evaluateTradeFinancialLegality({ team, leagueData, outgoingSalary, incomingSalary })?.ok);
}

function exactSalaryOk({ teamA, teamB, leagueData, aSalary, bSalary }) {
  return getFinancialOk(teamA, leagueData, aSalary, bSalary) && getFinancialOk(teamB, leagueData, bSalary, aSalary);
}

function validateRosterMax({ team, outgoingItems, incomingItems }) {
  const current = Array.isArray(team?.players) ? team.players.length : 0;
  const outgoingPlayers = (outgoingItems || []).filter((item) => item?.type === "player").length;
  const incomingPlayers = (incomingItems || []).filter((item) => item?.type === "player").length;
  const projected = current - outgoingPlayers + incomingPlayers;
  const allowedMax = Math.max(REGULAR_SEASON_MAX_STANDARD_PLAYERS, current);
  if (projected > allowedMax) {
    return { ok: false, reason: `${teamNameOf(team)} would have ${projected} standard players after the trade; max allowed here is ${allowedMax}.` };
  }
  return { ok: true };
}

function validateHardRules({ leagueData, teamA, teamB, aItems, bItems }) {
  if (!teamA || !teamB) return { ok: false, reason: "Missing one of the CPU teams." };
  if (!aItems.length || !bItems.length) return { ok: false, reason: "Both CPU teams must send at least one asset." };
  if (aItems.length > MAX_SIDE_ITEMS || bItems.length > MAX_SIDE_ITEMS) return { ok: false, reason: `One side exceeds the ${MAX_SIDE_ITEMS}-asset trade limit.` };

  const aRoster = validateRosterMax({ team: teamA, outgoingItems: aItems, incomingItems: bItems });
  if (!aRoster.ok) return aRoster;
  const bRoster = validateRosterMax({ team: teamB, outgoingItems: bItems, incomingItems: aItems });
  if (!bRoster.ok) return bRoster;

  const aFinancial = evaluateTradeFinancialLegality({ team: teamA, leagueData, outgoingSalary: sideSalary(aItems, leagueData), incomingSalary: sideSalary(bItems, leagueData) });
  if (!aFinancial.ok) return { ok: false, reason: aFinancial.message || `${teamNameOf(teamA)} fails salary matching.` };
  const bFinancial = evaluateTradeFinancialLegality({ team: teamB, leagueData, outgoingSalary: sideSalary(bItems, leagueData), incomingSalary: sideSalary(aItems, leagueData) });
  if (!bFinancial.ok) return { ok: false, reason: bFinancial.message || `${teamNameOf(teamB)} fails salary matching.` };

  return { ok: true, aRoster, bRoster, aFinancial, bFinancial };
}

function evaluateMutualCpuTrade({ leagueData, teamA, teamB, aItems, bItems }) {
  const hardRules = validateHardRules({ leagueData, teamA, teamB, aItems, bItems });
  if (!hardRules.ok) return { accepted: false, hardRules, reason: hardRules.reason };

  const teamAName = teamNameOf(teamA);
  const teamBName = teamNameOf(teamB);
  const teamAView = evaluateTradeTeamImpact({
    leagueData,
    userTeam: teamB,
    cpuTeam: teamA,
    userTeamName: teamBName,
    cpuTeamName: teamAName,
    userItems: bItems,
    cpuItems: aItems,
    evaluationMode: "standard",
  });
  if (!teamAView?.accepted) return { accepted: false, hardRules, teamAView, reason: teamAView?.message || "First CPU team rejects." };

  const teamBView = evaluateTradeTeamImpact({
    leagueData,
    userTeam: teamA,
    cpuTeam: teamB,
    userTeamName: teamAName,
    cpuTeamName: teamBName,
    userItems: aItems,
    cpuItems: bItems,
    evaluationMode: "standard",
  });

  return {
    accepted: Boolean(teamAView?.accepted && teamBView?.accepted),
    hardRules,
    teamAView,
    teamBView,
    reason: teamBView?.message || "Second CPU team rejects.",
  };
}

function compactProtectionLabel(asset = {}) {
  return getTradePickBaseProtectionLabel(asset) || asset.displayProtection || asset.protections || asset.protection || "Unprotected";
}

function draftPickKey(asset = {}) {
  return String(asset.id || asset.pickId || `${asset.year || asset.seasonYear || "future"}_${asset.round || 1}_${asset.originalTeam || asset.originalTeamName || "own"}_${asset.ownerTeam || asset.owner || ""}_${compactProtectionLabel(asset)}`);
}

function getTeamCode(teamName = "") {
  const parts = String(teamName || "").replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return "PICK";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.slice(-2).map((part) => part[0]).join("").toUpperCase();
}

function roundLabel(round = 1) {
  return Number(round || 1) === 2 ? "2nd" : "1st";
}

function buildPickPayload(asset, protection, tradeRule = null) {
  const protectionLabel = protection || compactProtectionLabel(asset) || "Unprotected";
  const pickNumber = Number(asset?.pickNumber || asset?.overallPick || asset?.resolvedPickNumber || 0);
  return {
    ...asset,
    id: draftPickKey(asset),
    owner: asset?.ownerTeam || asset?.owner || "",
    ownerTeam: asset?.ownerTeam || asset?.owner || "",
    originalTeam: asset?.originalTeam || asset?.originalTeamName || "Own",
    year: asset?.year || asset?.seasonYear || "Future",
    round: Number(asset?.round || 1),
    projectedRank: asset?.projectedRank || asset?.recordRank || asset?.expectedRank || pickNumber || undefined,
    protection: protectionLabel,
    protections: protectionLabel,
    displayProtection: protectionLabel,
    tradeRule: tradeRule || undefined,
  };
}

function fullPickDisplayLabel(asset = {}) {
  const base = getDraftPickAssetLabel(asset);
  const protection = compactProtectionLabel(asset);
  return protection && protection !== "Unprotected" ? `${base} (${protection})` : `${base} (Unprotected)`;
}

function roughPickValue(asset = {}, kind = "full", protectEnd = 0) {
  const round = Number(asset.round || 1);
  const year = Number(asset.year || asset.seasonYear || 2030);
  const current = 2026;
  const offsetPenalty = Math.max(0, year - current) * 0.06;
  if (round === 2) return Math.max(0.12, 0.34 - offsetPenalty * 0.45);
  let value = Math.max(0.75, 2.6 - offsetPenalty);
  if (kind === "protected") {
    const end = Number(protectEnd || 10);
    value *= end <= 3 ? 0.84 : end <= 5 ? 0.76 : end <= 10 ? 0.60 : end <= 14 ? 0.48 : 0.32;
  }
  if (kind === "swap") value *= 0.22;
  return Math.round(value * 1000) / 1000;
}

function makeDraftMove({ senderName, recipientName, senderItems = [], recipientItems = [], sourceKeys = [], value = 0, label = "Draft asset" }) {
  return {
    senderItems,
    recipientItems,
    value: Number(value || 0),
    label,
    sourceKeys: sourceKeys.filter(Boolean),
    senderItemCount: senderItems.length,
    recipientItemCount: recipientItems.length,
  };
}

function buildFullPickMove({ senderName, recipientName, asset }) {
  const protection = compactProtectionLabel(asset);
  const tradeRule = { action: "full", ownedRange: getTradeablePickOwnedRange(asset), source: "cpu_trade_opportunity" };
  const pick = buildPickPayload(asset, protection, tradeRule);
  const item = { type: "pick", teamName: senderName, protection: pick.protection, tradeRule, displayLabel: fullPickDisplayLabel(asset), pick };
  return makeDraftMove({ senderName, recipientName, senderItems: [item], value: roughPickValue(asset, "full"), label: item.displayLabel, sourceKeys: [getDraftPickConflictKey(pick)] });
}

function buildProtectedPickMove({ senderName, recipientName, asset, protectEnd }) {
  if (!canAddCustomProtectionToPick(asset)) return null;
  const owned = getTradeablePickOwnedRange(asset);
  const validation = validateCustomPickProtection(asset, owned.start, protectEnd);
  if (!validation.ok) return null;
  const tradeRule = {
    action: "protected",
    protectStart: validation.retainedRange.start,
    protectEnd: validation.retainedRange.end,
    retainedRange: validation.retainedRange,
    conveyedRange: validation.conveyedRange,
    ownedRange: validation.ownedRange,
    baseProtectionLabel: validation.baseProtectionLabel,
    source: "cpu_trade_opportunity",
  };
  const pick = buildPickPayload(asset, validation.baseProtectionLabel, tradeRule);
  const base = getDraftPickAssetLabel(asset);
  const item = { type: "pick", teamName: senderName, protection: validation.baseProtectionLabel, tradeRule, displayLabel: `${validation.baseProtectionLabel} ${base} (conveys ${validation.conveyedRange.start}-${validation.conveyedRange.end})`, pick };
  return makeDraftMove({ senderName, recipientName, senderItems: [item], value: roughPickValue(asset, "protected", protectEnd), label: item.displayLabel, sourceKeys: [getDraftPickConflictKey(pick)] });
}

function swapDirectionLabel(direction = "best") {
  return String(direction).toLowerCase() === "worst" ? "Swap Worst" : "Swap Best";
}

function inverseSwapDirection(direction = "best") {
  return String(direction).toLowerCase() === "worst" ? "best" : "worst";
}

function buildSwapDisplayLabel(direction, sourcePick, swapPick) {
  const participants = [sourcePick.originalTeam || sourcePick.originalTeamName, swapPick.originalTeam || swapPick.originalTeamName]
    .filter(Boolean)
    .map(getTeamCode)
    .join(" / ");
  return `${swapDirectionLabel(direction)} ${sourcePick.year || "Future"} ${roundLabel(sourcePick.round)} - ${participants || "Pick A / Pick B"}`;
}

function buildSwapMove({ senderName, recipientName, sourcePick, swapPick, direction = "best" }) {
  if (!canCreateSwapWithPick(sourcePick) || !canCreateSwapWithPick(swapPick)) return null;
  const swapId = `cpu_opp_swap_${draftPickKey(sourcePick)}_${draftPickKey(swapPick)}_${direction}`.replace(/[^a-zA-Z0-9_]+/g, "_");
  const mirrorDirection = inverseSwapDirection(direction);
  const tradeRule = {
    action: "swap",
    swapId,
    swapDirection: direction,
    swapRightHolder: recipientName,
    fromTeamName: senderName,
    toTeamName: recipientName,
    sourcePick,
    swapPick,
    source: "cpu_trade_opportunity",
  };
  const mirrorRule = { ...tradeRule, mirror: true, swapDirection: mirrorDirection, swapRightHolder: senderName };
  const primaryPick = buildPickPayload(sourcePick, swapDirectionLabel(direction), tradeRule);
  const mirrorPick = buildPickPayload(swapPick, swapDirectionLabel(mirrorDirection), mirrorRule);
  const primaryItem = { type: "pick", teamName: senderName, protection: swapDirectionLabel(direction), tradeRule, displayLabel: buildSwapDisplayLabel(direction, sourcePick, swapPick), pick: primaryPick };
  const mirrorItem = { type: "pick", teamName: recipientName, protection: swapDirectionLabel(mirrorDirection), tradeRule: mirrorRule, tradeValueExcluded: true, displayOnlyLinkedSwap: true, displayLabel: buildSwapDisplayLabel(mirrorDirection, swapPick, sourcePick), pick: mirrorPick };
  return makeDraftMove({
    senderName,
    recipientName,
    senderItems: [primaryItem],
    recipientItems: [mirrorItem],
    value: roughPickValue(sourcePick, "swap"),
    label: primaryItem.displayLabel,
    sourceKeys: [getDraftPickConflictKey(sourcePick), getDraftPickConflictKey(swapPick)],
  });
}

function getAvailableDraftPicksForTeam(leagueData, teamName = "", options = {}) {
  const teamNames = getTeamNamesFromLeague(leagueData);
  const seasonYear = getCurrentSeasonYear(leagueData);
  const rows = normalizeDraftPicks(Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [], teamNames);
  const activeSwapKeys = getActiveSwapParticipantKeySet(rows, leagueData);
  const teamKey = normalizeTeamName(teamName);
  const includeSeconds = options.includeSeconds !== false;
  const seen = new Set();

  return rows
    .map((row, index) => normalizeDraftPickAsset(row, index, teamNames))
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick.year || 0) >= seasonYear)
    .filter((pick) => !isSwapDraftPickAsset(pick) && !isResolvedDraftPickAsset(pick))
    .filter((pick) => includeSeconds || Number(pick.round || 1) !== 2)
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || "") === teamKey)
    .filter((pick) => !isDraftPickEncumberedByActiveSwap(pick, rows, leagueData, { activeSwapKeys }))
    .filter((pick) => {
      const key = draftPickKey(pick);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(sortDraftPickAssets);
}

function buildDraftMovePalette({ leagueData, senderName, recipientName, options = {} }) {
  const picks = getAvailableDraftPicksForTeam(leagueData, senderName, options);
  const recipientPicks = getAvailableDraftPicksForTeam(leagueData, recipientName, { ...options, includeSeconds: false });
  const firsts = picks.filter((pick) => Number(pick.round || 1) === 1).slice(0, 6);
  const seconds = picks.filter((pick) => Number(pick.round || 1) === 2).slice(0, 5);
  const moves = [];

  for (const pick of firsts) {
    moves.push(buildFullPickMove({ senderName, recipientName, asset: pick }));
    if (options.includeProtections !== false) {
      const full = getDefaultPickOwnedRange(1);
      const owned = getTradeablePickOwnedRange(pick);
      const ends = PROTECTION_ENDS.filter((end) => Number(owned.start) === Number(full.start) && end < Number(owned.end)).slice(0, 3);
      for (const end of ends) {
        const protectedMove = buildProtectedPickMove({ senderName, recipientName, asset: pick, protectEnd: end });
        if (protectedMove) moves.push(protectedMove);
      }
    }
  }

  if (options.includeSeconds !== false) {
    for (const pick of seconds) moves.push(buildFullPickMove({ senderName, recipientName, asset: pick }));
  }

  if (options.includeSwaps !== false) {
    const recipientFirstsByYear = new Map();
    for (const pick of recipientPicks.filter((pick) => Number(pick.round || 1) === 1 && canCreateSwapWithPick(pick)).slice(0, 5)) {
      recipientFirstsByYear.set(Number(pick.year || 0), pick);
    }
    for (const sourcePick of firsts.filter(canCreateSwapWithPick).slice(0, 5)) {
      const swapPick = recipientFirstsByYear.get(Number(sourcePick.year || 0));
      if (!swapPick) continue;
      const best = buildSwapMove({ senderName, recipientName, sourcePick, swapPick, direction: "best" });
      if (best) moves.push(best);
      const worst = buildSwapMove({ senderName, recipientName, sourcePick, swapPick, direction: "worst" });
      if (worst) moves.push(worst);
    }
  }

  const seen = new Set();
  return moves
    .filter((move) => move && move.value > EPS)
    .sort((a, b) => b.value - a.value || a.senderItemCount - b.senderItemCount)
    .filter((move) => {
      const normalized = String(move.label || "").replace(/20\d{2}/g, "YEAR").replace(/Top \d+/gi, "TOP");
      const family = `${normalized}|${move.senderItemCount}|${move.recipientItemCount}`;
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    })
    .slice(0, 14);
}

function getDraftPaletteCacheKey({ senderName, recipientName, options = {} }) {
  return [
    normalizeTeamName(senderName),
    normalizeTeamName(recipientName),
    options.includeProtections !== false ? "prot" : "noProt",
    options.includeSwaps !== false ? "swap" : "noSwap",
    options.includeSeconds !== false ? "sec" : "noSec",
  ].join("|");
}

function getCachedDraftMovePalette({ leagueData, senderName, recipientName, options = {} }) {
  const cache = options.__paletteCache;
  if (!cache) return buildDraftMovePalette({ leagueData, senderName, recipientName, options });
  const key = getDraftPaletteCacheKey({ senderName, recipientName, options });
  if (!cache.has(key)) {
    cache.set(key, buildDraftMovePalette({ leagueData, senderName, recipientName, options }));
  }
  return cache.get(key) || [];
}

function canCombineDraftMoves(combo = [], move = {}) {
  const used = new Set(combo.flatMap((existing) => existing.sourceKeys || []));
  return !(move.sourceKeys || []).some((key) => used.has(key));
}

function buildDraftPackage({ moves = [], target = 0, maxDraftAssets = 2, remainingSenderSlots = 0, remainingRecipientSlots = 0, allowBig = false }) {
  const usable = moves
    .filter((move) => move.senderItemCount <= remainingSenderSlots && move.recipientItemCount <= remainingRecipientSlots)
    .sort((a, b) => Math.abs(a.value - target) - Math.abs(b.value - target) || b.value - a.value);
  if (!usable.length || maxDraftAssets <= 0) return null;

  let best = null;
  const consider = (combo) => {
    const senderItems = combo.flatMap((move) => move.senderItems || []);
    const recipientItems = combo.flatMap((move) => move.recipientItems || []);
    if (senderItems.length > remainingSenderSlots || recipientItems.length > remainingRecipientSlots) return;
    const keys = combo.flatMap((move) => move.sourceKeys || []);
    if (new Set(keys).size !== keys.length) return;
    const value = combo.reduce((sum, move) => sum + Number(move.value || 0), 0);
    const score = Math.abs(value - target) + senderItems.length * 0.10 + recipientItems.length * 0.14 - (value >= target ? 0.15 : 0);
    const candidate = { senderItems, recipientItems, value, label: combo.map((move) => move.label).join(" + "), sourceKeys: keys, score };
    if (!best || candidate.score < best.score) best = candidate;
  };

  usable.slice(0, 8).forEach((move) => consider([move]));

  const maxCombo = Math.min(maxDraftAssets, remainingSenderSlots, allowBig ? 5 : 3);
  if (maxCombo >= 2) {
    for (let i = 0; i < Math.min(7, usable.length); i += 1) {
      const combo = [usable[i]];
      let total = usable[i].value;
      for (let j = 0; j < usable.length && combo.length < maxCombo; j += 1) {
        if (j === i || !canCombineDraftMoves(combo, usable[j])) continue;
        if (!allowBig && total >= target * 1.25) break;
        combo.push(usable[j]);
        total += usable[j].value;
        consider(combo.slice());
        if (total >= target && !allowBig) break;
      }
    }
  }

  return best;
}

function packageKey(items = []) {
  return items.map((item) => {
    if (item?.type === "player") return `p:${playerKey(item.player)}`;
    if (item?.type === "pick") return `d:${item.displayLabel || item.pick?.id || item.pick?.year}`;
    return JSON.stringify(item || {});
  }).sort().join("||");
}

function tradeKey(aItems = [], bItems = []) {
  return `${packageKey(aItems)}::${packageKey(bItems)}`;
}

function playerCoreKey(aItems = [], bItems = []) {
  const a = aItems.filter((i) => i.type === "player");
  const b = bItems.filter((i) => i.type === "player");
  return `${packageKey(a)}::${packageKey(b)}`;
}

function makeResult({ teamA, teamB, aItems, bItems, evaluation, source = "proposal", draftPackage = null, template = "CPU proposal" }) {
  return {
    id: `cpu_trade_${normalizeTeamName(teamNameOf(teamA))}_${normalizeTeamName(teamNameOf(teamB))}_${tradeKey(aItems, bItems)}`,
    source,
    template,
    teamAName: teamNameOf(teamA),
    teamBName: teamNameOf(teamB),
    teamAItems: aItems,
    teamBItems: bItems,
    teamAReceives: bItems,
    teamBReceives: aItems,
    teamAView: evaluation.teamAView,
    teamBView: evaluation.teamBView,
    hardRules: evaluation.hardRules,
    draftPackage,
    combinedScore: Number(evaluation.teamAView?.score || 0) + Number(evaluation.teamBView?.score || 0),
  };
}

function makeCandidate({ teamA, teamB, aPackage, bPackage, template = "balanced", priority = 0, needDraftFrom = null, draftPackage = null }) {
  const aItems = [...(aPackage?.items || [])];
  const bItems = [...(bPackage?.items || [])];
  if (draftPackage) {
    if (needDraftFrom === "A") {
      aItems.push(...(draftPackage.senderItems || []));
      bItems.push(...(draftPackage.recipientItems || []));
    } else if (needDraftFrom === "B") {
      bItems.push(...(draftPackage.senderItems || []));
      aItems.push(...(draftPackage.recipientItems || []));
    }
  }
  return {
    teamA,
    teamB,
    aPackage,
    bPackage,
    aItems,
    bItems,
    template,
    priority,
    draftPackage,
    coreKey: playerCoreKey(aItems, bItems),
    tradeKey: tradeKey(aItems, bItems),
  };
}

function findSalaryPackages({ senderPackage, receiverProfile, senderTeam, receiverTeam, leagueData, maxMatches = 3 }) {
  const candidates = receiverProfile.packagePool || [];
  const out = [];
  for (const pkg of candidates) {
    if (out.length >= maxMatches * 4) break;
    if (!pkg?.items?.length) continue;
    if (!exactSalaryOk({ teamA: senderTeam, teamB: receiverTeam, leagueData, aSalary: senderPackage.salary, bSalary: pkg.salary })) continue;
    const salaryDiff = Math.abs(senderPackage.salary - pkg.salary) / 5_000_000;
    const valueDiff = Math.abs(senderPackage.value - pkg.value) * 0.025;
    out.push({ pkg, score: salaryDiff + valueDiff + Math.abs(senderPackage.count - pkg.count) * 0.25 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, maxMatches).map((row) => row.pkg);
}

function buildPackagePool(profile, depth = "instant") {
  const config = MODE_CONFIG[cleanDepth(depth)];
  const maxPlayers = config.maxPlayers;
  const rows = profile.rows;
  const out = [];
  const push = (pkg) => {
    if (!pkg || !pkg.items?.length || pkg.count > maxPlayers) return;
    if (!out.some((row) => row.key === pkg.key)) out.push(pkg);
  };

  for (const row of rows) push(packageFromRows(profile.name, [row]));

  const anchors = profile.anchors.slice(0, cleanDepth(depth) === "instant" ? 12 : 16);
  for (const anchor of anchors) {
    const pools = [profile.bySalaryAsc, profile.bySalary, profile.lowSalaryUseful, profile.badContracts, profile.young, profile.vets];
    for (const pool of pools) {
      const filler = pool.find((row) => row.key !== anchor.key);
      if (filler) push(packageFromRows(profile.name, [anchor, filler]));
    }
    if (maxPlayers >= 3) {
      push(addBestFillers({ profile, anchors: [anchor], targetSalary: anchor.salary + 12_000_000, maxPlayers: 3, prefer: "neutral" }));
      push(addBestFillers({ profile, anchors: [anchor], targetSalary: anchor.salary + 24_000_000, maxPlayers: 3, prefer: "salary" }));
    }
    if (maxPlayers >= 4) {
      push(addBestFillers({ profile, anchors: [anchor], targetSalary: anchor.salary + 34_000_000, maxPlayers: 4, prefer: "salary" }));
    }
    if (maxPlayers >= 5) {
      push(addBestFillers({ profile, anchors: [anchor], targetSalary: anchor.salary + 45_000_000, maxPlayers: 5, prefer: "salary" }));
    }
  }

  return out.sort((a, b) => a.salary - b.salary || b.value - a.value).slice(0, cleanDepth(depth) === "instant" ? 70 : cleanDepth(depth) === "quick" ? 90 : 110);
}

function addDraftVariant({ leagueData, candidate, options, targetGap = 0, big = false, medium = false }) {
  const { teamA, teamB, aPackage, bPackage } = candidate;
  const needDraftFrom = candidate.needDraftFrom;
  if (!needDraftFrom) return null;
  const senderName = needDraftFrom === "A" ? teamNameOf(teamA) : teamNameOf(teamB);
  const recipientName = needDraftFrom === "A" ? teamNameOf(teamB) : teamNameOf(teamA);
  const senderItems = needDraftFrom === "A" ? candidate.aItems : candidate.bItems;
  const recipientItems = needDraftFrom === "A" ? candidate.bItems : candidate.aItems;
  const remainingSenderSlots = MAX_SIDE_ITEMS - senderItems.length;
  const remainingRecipientSlots = MAX_SIDE_ITEMS - recipientItems.length;
  if (remainingSenderSlots <= 0) return null;

  const moves = getCachedDraftMovePalette({ leagueData, senderName, recipientName, options });
  const mode = cleanDepth(options.depth);
  const config = MODE_CONFIG[mode];
  const maxDraftAssets = big ? config.maxDraftAssetsBig : medium ? config.maxDraftAssetsMedium : config.maxDraftAssetsSmall;
  const draftPackage = buildDraftPackage({
    moves,
    target: Math.max(0.35, targetGap),
    maxDraftAssets,
    remainingSenderSlots,
    remainingRecipientSlots,
    allowBig: big,
  });
  if (!draftPackage) return null;
  return makeCandidate({
    teamA,
    teamB,
    aPackage,
    bPackage,
    template: `${candidate.template} + draft solve`,
    priority: candidate.priority - 0.35 + Math.abs((draftPackage.value || 0) - targetGap) * 0.18,
    needDraftFrom,
    draftPackage,
  });
}

function ensureProfilePackagePool(profile, mode) {
  if (!profile.packagePool) profile.packagePool = buildPackagePool(profile, mode);
  return profile;
}

function buildMatchupCandidates({ leagueData, teamA, teamB, depth = "instant", options = {}, profileA: providedProfileA = null, profileB: providedProfileB = null }) {
  const mode = cleanDepth(depth);
  const config = MODE_CONFIG[mode];
  const profileA = ensureProfilePackagePool(providedProfileA || buildTeamProfile(teamA, leagueData, mode), mode);
  const profileB = ensureProfilePackagePool(providedProfileB || buildTeamProfile(teamB, leagueData, mode), mode);

  const candidates = [];
  const push = (candidate) => {
    if (!candidate || !candidate.aItems?.length || !candidate.bItems?.length) return;
    if (candidate.aItems.length > MAX_SIDE_ITEMS || candidate.bItems.length > MAX_SIDE_ITEMS) return;
    if (candidates.some((row) => row.tradeKey === candidate.tradeKey)) return;
    candidates.push(candidate);
  };

  const seedPackagesA = [
    ...profileA.packagePool.filter((p) => p.count === 1).slice(0, mode === "instant" ? 5 : 7),
    ...profileA.packagePool.filter((p) => p.count >= 2).slice(0, mode === "instant" ? 5 : 8),
  ].slice(0, mode === "instant" ? 8 : mode === "quick" ? 11 : 14);

  for (const aPkg of seedPackagesA) {
    const matches = findSalaryPackages({ senderPackage: aPkg, receiverProfile: profileB, senderTeam: teamA, receiverTeam: teamB, leagueData, maxMatches: mode === "instant" ? 1 : 2 });
    for (const bPkg of matches) {
      const valueGap = bPkg.value - aPkg.value;
      const maxStar = Math.max(aPkg.ovrMax, bPkg.ovrMax);
      const isBlockbuster = maxStar >= 88 || Math.abs(valueGap) >= 26;
      const needDraftFrom = Math.abs(valueGap) >= 5 ? (valueGap > 0 ? "A" : "B") : null;
      const priority = Math.abs(valueGap) * 0.33 + Math.abs(aPkg.salary - bPkg.salary) / 6_000_000 + Math.abs(aPkg.count - bPkg.count) * 0.3 - maxStar * 0.015;
      const base = makeCandidate({ teamA, teamB, aPackage: aPkg, bPackage: bPkg, template: isBlockbuster ? "blockbuster core" : "player core", priority, needDraftFrom });
      push(base);
      if (needDraftFrom) {
        const draft = addDraftVariant({ leagueData, candidate: base, options: { ...options, depth: mode }, targetGap: Math.abs(valueGap) * 0.095, big: isBlockbuster, medium: !isBlockbuster && Math.abs(valueGap) >= 14 });
        push(draft);
      }
    }
  }

  // Explicit star-bid templates: young asset + salary + larger draft package for a star/near-star.
  const starBid = (buyerProfile, sellerProfile, buyerTeam, sellerTeam, buyerIsA) => {
    const sellerStars = sellerProfile.stars.slice(0, mode === "instant" ? 1 : 2);
    for (const star of sellerStars) {
      const young = buyerProfile.young[0] || buyerProfile.byValue[0];
      if (!young) continue;
      const buyerPkg = addBestFillers({ profile: buyerProfile, anchors: [young], targetSalary: star.salary, maxPlayers: config.maxPlayers, prefer: "salary" });
      const sellerPkg = packageFromRows(sellerProfile.name, [star]);
      if (!buyerPkg.items.length || !sellerPkg.items.length) continue;
      const aPkg = buyerIsA ? buyerPkg : sellerPkg;
      const bPkg = buyerIsA ? sellerPkg : buyerPkg;
      if (!exactSalaryOk({ teamA, teamB, leagueData, aSalary: aPkg.salary, bSalary: bPkg.salary })) continue;
      const valueGap = bPkg.value - aPkg.value;
      const needDraftFrom = buyerIsA ? "A" : "B";
      const base = makeCandidate({ teamA, teamB, aPackage: aPkg, bPackage: bPkg, template: "star bid", priority: 1.2 + Math.max(0, Math.abs(valueGap) - 10) * 0.08, needDraftFrom });
      const draft = addDraftVariant({ leagueData, candidate: base, options: { ...options, depth: mode }, targetGap: Math.max(2.2, Math.abs(valueGap) * 0.12), big: true });
      push(draft || base);
    }
  };
  starBid(profileA, profileB, teamA, teamB, true);
  starBid(profileB, profileA, teamB, teamA, false);

  return candidates
    .filter((candidate) => validateHardRules({ leagueData, teamA, teamB, aItems: candidate.aItems, bItems: candidate.bItems }).ok)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, config.maxCandidatesPerOpponent);
}

export async function scanCpuTradeMarket({ leagueData, focusTeamName, opponentTeamName = "all", userTeamName = "", options = {}, onProgress = null, tokenRef = null, token = null } = {}) {
  const depth = cleanDepth(options.depth);
  const config = MODE_CONFIG[depth];
  const startedAt = Date.now();
  const focusTeam = findTeam(leagueData, focusTeamName);
  const cpuTeams = getAllTeamsFromLeague(leagueData).filter((team) => {
    const name = teamNameOf(team);
    if (!name || sameTeamName(name, userTeamName) || sameTeamName(name, focusTeamName)) return false;
    if (opponentTeamName !== "all" && !sameTeamName(name, opponentTeamName)) return false;
    return true;
  });
  const isAll = opponentTeamName === "all";
  const exactBudget = isAll ? config.exactBudgetAll : config.exactBudgetSingle;
  const perOpponentExact = isAll ? config.exactPerOpponentAll : config.exactPerOpponentSingle;
  const wallBudget = isAll ? config.wallMsAll : config.wallMsSingle;
  const maxResults = isAll ? config.maxResultsAll : config.maxResultsSingle;
  const maxResultsPerOpponent = config.maxResultsPerOpponent || 2;
  const rows = [];
  const rowsByOpponent = new Map();
  const profileCache = new Map();
  const paletteCache = new Map();
  const seenCore = new Set();
  const seenTrade = new Set();
  const stats = {
    focusTeamName,
    opponentsQueued: cpuTeams.length,
    proposalCandidates: 0,
    exactEvaluations: 0,
    mutualAcceptsFound: 0,
    capped: false,
    timeCapped: false,
    elapsedMs: 0,
    startedAt,
  };

  if (!focusTeam) {
    return { rows: [], stats: { ...stats, error: "Missing focus team.", elapsedMs: Date.now() - startedAt } };
  }

  const getProfile = (team) => {
    const name = normalizeTeamName(teamNameOf(team));
    if (!profileCache.has(name)) {
      const profile = buildTeamProfile(team, leagueData, depth);
      profile.packagePool = buildPackagePool(profile, depth);
      profileCache.set(name, profile);
    }
    return profileCache.get(name);
  };

  const focusProfile = getProfile(focusTeam);

  const makeEmptyRow = (opponentName) => ({
    opponentTeamName: opponentName,
    focusTeamName: teamNameOf(focusTeam),
    trades: [],
    stats: {
      proposalCandidates: 0,
      exactEvaluations: 0,
      mutualAcceptsFound: 0,
      elapsedMs: 0,
      capped: false,
      timeCapped: false,
    },
  });

  const addRowIfMissing = (opponentName) => {
    if (!rowsByOpponent.has(opponentName)) {
      const row = makeEmptyRow(opponentName);
      rowsByOpponent.set(opponentName, row);
      rows.push(row);
    }
    return rowsByOpponent.get(opponentName);
  };

  for (let i = 0; i < cpuTeams.length; i += 1) {
    if (tokenRef && tokenRef.current !== token) break;
    if (stats.exactEvaluations >= exactBudget || stats.mutualAcceptsFound >= maxResults) {
      stats.capped = true;
      break;
    }
    if (Date.now() - startedAt > wallBudget) {
      stats.timeCapped = true;
      break;
    }

    const opponent = cpuTeams[i];
    const opponentName = teamNameOf(opponent);
    const row = addRowIfMissing(opponentName);
    const beforeOpponent = Date.now();
    onProgress?.(`Finding opportunities for ${focusTeamName} vs ${opponentName} (${i + 1}/${cpuTeams.length})...`);
    await waitFrame();

    const opponentProfile = getProfile(opponent);
    const candidates = buildMatchupCandidates({
      leagueData,
      teamA: focusTeam,
      teamB: opponent,
      depth,
      options: { ...options, depth, __paletteCache: paletteCache },
      profileA: focusProfile,
      profileB: opponentProfile,
    });

    row.stats.proposalCandidates = candidates.length;
    stats.proposalCandidates += candidates.length;

    const localSeenCore = new Set();
    let opponentChecks = 0;
    for (const candidate of candidates) {
      if (tokenRef && tokenRef.current !== token) break;
      if (stats.exactEvaluations >= exactBudget || stats.mutualAcceptsFound >= maxResults) {
        stats.capped = true;
        break;
      }
      if (opponentChecks >= perOpponentExact || row.trades.length >= maxResultsPerOpponent) break;
      if (Date.now() - startedAt > wallBudget) {
        stats.timeCapped = true;
        break;
      }
      if (seenTrade.has(candidate.tradeKey) || seenCore.has(candidate.coreKey) || localSeenCore.has(candidate.coreKey)) continue;
      seenTrade.add(candidate.tradeKey);
      seenCore.add(candidate.coreKey);
      localSeenCore.add(candidate.coreKey);

      onProgress?.(`Exact-checking ${focusTeamName} vs ${opponentName} (${opponentChecks + 1}/${perOpponentExact})...`);
      await waitFrame();
      stats.exactEvaluations += 1;
      row.stats.exactEvaluations += 1;
      opponentChecks += 1;

      const evaluation = evaluateMutualCpuTrade({ leagueData, teamA: candidate.teamA, teamB: candidate.teamB, aItems: candidate.aItems, bItems: candidate.bItems });
      if (!evaluation.accepted) continue;

      row.trades.push(makeResult({
        teamA: candidate.teamA,
        teamB: candidate.teamB,
        aItems: candidate.aItems,
        bItems: candidate.bItems,
        evaluation,
        source: candidate.draftPackage ? "proposal_draft" : "proposal_player",
        draftPackage: candidate.draftPackage,
        template: candidate.template,
      }));
      row.stats.mutualAcceptsFound = row.trades.length;
      stats.mutualAcceptsFound += 1;
      await waitFrame();
    }

    row.stats.elapsedMs = Date.now() - beforeOpponent;
    row.stats.capped = opponentChecks >= perOpponentExact || row.trades.length >= maxResultsPerOpponent;
    row.stats.timeCapped = stats.timeCapped;
    await waitFrame();
  }

  // Always include the rest of the opponent list so the all-teams UI stays predictable.
  for (const opponent of cpuTeams) {
    addRowIfMissing(teamNameOf(opponent));
  }

  const finalRows = rows.map((row) => ({
    ...row,
    stats: {
      ...row.stats,
      elapsedMs: row.stats.elapsedMs || Date.now() - startedAt,
      capped: row.stats.capped || stats.capped || stats.timeCapped,
    },
    trades: row.trades.sort((a, b) => b.combinedScore - a.combinedScore),
  })).sort((a, b) => (b.trades.length - a.trades.length) || a.opponentTeamName.localeCompare(b.opponentTeamName));

  stats.elapsedMs = Date.now() - startedAt;
  return { rows: finalRows, stats };
}

export function scanCpuTradeOpponent(args = {}) {
  // Compatibility shim for older panel code. This function is now intentionally
  // shallow; the real fast path is scanCpuTradeMarket(), which ranks proposals
  // globally before spending exact evaluator calls.
  let response = { rows: [], stats: {} };
  scanCpuTradeMarket({ ...args, opponentTeamName: args.opponentTeamName || "all" }).then((result) => {
    response = result;
  });
  return response.rows?.[0] || { opponentTeamName: args.opponentTeamName || "Opponent", trades: [], stats: { error: "Use scanCpuTradeMarket async API." } };
}

export function getCpuTradeScannerTeams(leagueData, userTeamName = "") {
  return getAllTeamsFromLeague(leagueData)
    .map((team) => ({ name: teamNameOf(team), logo: team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || team?.img || "" }))
    .filter((team) => team.name && !sameTeamName(team.name, userTeamName))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function describeCpuTradeAsset(item = {}) {
  if (item?.type === "player") {
    const player = item.player || {};
    const bits = [];
    if (player.pos || player.position) bits.push(player.pos || player.position);
    const overall = Number(player.overall ?? player.ovr ?? 0);
    const potential = Number(player.potential ?? player.pot ?? 0);
    if (overall) bits.push(`OVR ${overall}`);
    if (potential) bits.push(`POT ${potential}`);
    return { type: "player", label: playerNameOf(player), meta: bits.join(" • ") };
  }
  if (item?.type === "pick") {
    return {
      type: "pick",
      label: item.displayLabel || item.pick?.displayLabel || item.pick?.label || "Draft pick",
      meta: item.tradeValueExcluded ? "Linked swap display only" : item.protection || item.pick?.protection || "Draft asset",
    };
  }
  return { type: "asset", label: "Asset", meta: "" };
}
