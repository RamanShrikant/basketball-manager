import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { evaluateTradeTeamImpact } from "../utils/tradeTeamImpact.js";
import { executeAcceptedTradeOnLeague as executeAcceptedTradeOnLeagueShared } from "../utils/tradeExecution.js";
import {
  buildTradeMachineSwapAssets,
  canCreateSwapWithPick,
  getDraftPickConflictKey,
  getDraftPickEncumbranceReason,
  getTradeablePickOwnedRange,
  makeTradeGeneratedDraftPickId,
  normalizeDraftPickAsset,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  removeDirectPickRowsConsumedBySwap,
  validateCustomPickProtection,
} from "../utils/draftPicks.js";
import { saveLeagueData } from "../utils/leagueStorage.js";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const TRADE_DEBUG_KEY = "bm_trade_debug_v1";
const TRADE_DEADLINE_STATUS_KEY = "bm_trade_deadline_status_v1";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const MAX_SIDE_ITEMS = 8;
const REGULAR_SEASON_MAX_STANDARD_PLAYERS = 16;
const TRADE_MATCHING_SMALL_OUTGOING = 7_500_000;
const TRADE_MATCHING_MID_OUTGOING = 29_000_000;
const TRADE_MATCHING_BUFFER = 250_000;
const TRADE_SALARY_TOLERANCE = 1_000;


// Manual trade-card layout controls.
// Change only these numbers to move/resize the player face, OVR ring, name,
// position/age line, and contract line inside each selected trade asset card.
const TRADE_PLAYER_CARD_TUNING = {
  cardHeight: 126,
  face: {
    boxWidth: 180,
    imageHeight: 180,
    x: 0,
    y: 32,
  },
  ring: {
    size: 95,
    x: -12,
    y: 14,
  },
  ringText: {
    ovrLabel: {
      size: 12,
      x: 0,
      y: 0,
    },
    ovrNumber: {
      size: 30,
      x: 0,
      y: 0,
    },
    potLine: {
      size: 8,
      x: 0,
      y: 0,
    },
  },
  textBlock: {
    x: 0,
    y: 0,
  },
  name: {
    size: 30,
    x: 0,
    y: 0,
  },
  positionAge: {
    size: 16,
    x: 0,
    y: 0,
  },
  contract: {
    size: 13,
    x: 0,
    y: 0,
  },
};


// Manual background-logo controls for every trade item pill.
// This places the item's team logo behind player/pick content at low opacity.
const TRADE_ITEM_BACKGROUND_LOGO_TUNING = {
  enabled: true,
  size: 500,
  opacity: 0.17,
  x: 0,
  y: 0,
  rotate: 0,
  blur: 0,
  brightness: 1.35,
  contrast: 1.15,
  saturate: 1.25,
  blendMode: "screen",
};

// Manual team-specific logo watermark controls.
// These override TRADE_ITEM_BACKGROUND_LOGO_TUNING only for matching team logos.
// This affects player pills by the player/team side and draft-pick pills by the pick's original team.
const TRADE_ITEM_BACKGROUND_LOGO_TEAM_OVERRIDES = {
  pelicans: {
    size: 500,
    opacity: 0.2,
    x: 0,
    y: 0,
    rotate: 0,
    blur: 0,
    brightness: 1.45,
    contrast: 1.2,
    saturate: 1.35,
    blendMode: "screen",
  },
  trailBlazers: {
    size: 900,
    opacity: 0.3,
    x: 0,
    y: 120,
    rotate: 0,
    blur: 0,
    brightness: 1.85,
    contrast: 1.25,
    saturate: 1.5,
    blendMode: "screen",
  },
};


// Manual 2K-style financial-footer controls.
// Change these numbers to move/resize the team logo, financial text,
// value column, and Valid Trade / Hard Cap Issue bar at the bottom of each side.
const TRADE_FINANCIAL_FOOTER_TUNING = {
  footer: {
    paddingX: 20,
    paddingY: 12,
    logoColumnWidth: 150,
    gap: 22,
    x: 0,
    y: 0,
  },
  logo: {
    size: 118,
    x: 0,
    y: 0,
  },
  rowsBlock: {
    x: 0,
    y: 0,
    width: "100%",
  },
  rows: {
    gap: 2,
  },
  label: {
    size: 14,
    x: 0,
    y: 0,
    letterSpacing: "0.08em",
  },
  value: {
    size: 14,
    x: 0,
    y: 0,
  },
  statusBar: {
    height: 30,
    marginTop: 8,
    width: "100%",
    x: 0,
    y: 0,
    fontSize: 14,
    textX: 0,
    textY: 0,
  },
};

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function teamLogoOf(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

function getTradeCardNameFontSize(name, baseSize = 30) {
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  const len = clean.length;
  if (!len) return baseSize;

  // Selected trade cards reserve fixed space for the face art and OVR ring.
  // Long names should shrink to fit inside that remaining text lane instead
  // of widening the card and hiding the remove button.
  const estimatedFit = 230 / Math.max(1, len * 0.62);
  return Math.max(16, Math.min(baseSize, Math.round(estimatedFit)));
}

function getCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

function finitePositiveYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year >= 2000 && year <= 2100 ? year : null;
}

function pushUniqueYear(list, value) {
  const year = finitePositiveYear(value);
  if (year && !list.includes(year)) list.push(year);
}

function getLeagueLabelPayrollYear(leagueData) {
  const label = [
    leagueData?.name,
    leagueData?.leagueName,
    leagueData?.title,
    leagueData?.fileName,
    leagueData?.metadata?.name,
    leagueData?.meta?.name,
  ]
    .filter(Boolean)
    .join(" ");

  const fullRange = label.match(/(?:^|\D)(20\d{2})\s*[\/-]\s*(20\d{2})(?:\D|$)/);
  if (fullRange) return finitePositiveYear(fullRange[2]);

  const shortRange = label.match(/(?:^|\D)(\d{2})\s*[\/-]\s*(\d{2})(?:\D|$)/);
  if (shortRange) return finitePositiveYear(2000 + Number(shortRange[2]));

  return null;
}

function getSalaryForPayrollYear(player, payrollSeasonYear) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => Number(value) || 0)
    : [];

  if (salaries.length) {
    let startYear = Number(contract.startYear || payrollSeasonYear);
    let idx = payrollSeasonYear - startYear;
    const lastYear = startYear + salaries.length - 1;
    const hasPayrollSeasonSlot = idx >= 0 && idx < salaries.length;

    // SalaryTable treats one-year deals that were created in the prior offseason
    // as active for the displayed payroll season. Keep trade screens aligned.
    if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && !hasPayrollSeasonSlot) {
      startYear = payrollSeasonYear;
      idx = 0;
    }

    if (idx >= 0 && idx < salaries.length) return Number(salaries[idx] || 0);
    if (payrollSeasonYear > lastYear) return Number(salaries[salaries.length - 1] || 0);
    return Number(salaries[0] || 0);
  }

  const fallback = Number(
    player?.salary ??
      player?.currentSalary ??
      player?.contractSalary ??
      player?.capHit ??
      player?.aav ??
      0
  );

  return Number.isFinite(fallback) ? fallback : 0;
}

function getStoredTeamPayroll(team) {
  const value = Number(
    team?.payroll ??
      team?.totalSalary ??
      team?.salaryTotal ??
      team?.financials?.payroll ??
      team?.financials?.totalSalary ??
      0
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getRosterPayrollForYear(team, payrollSeasonYear) {
  return (Array.isArray(team?.players) ? team.players : []).reduce(
    (sum, player) => sum + getSalaryForPayrollYear(player, payrollSeasonYear),
    0
  );
}

function getTradePayrollSeasonYear(leagueData) {
  const candidates = [];

  // Explicit payroll fields win first if a future save adds them.
  pushUniqueYear(candidates, leagueData?.payrollSeasonYear);
  pushUniqueYear(candidates, leagueData?.salarySeasonYear);
  pushUniqueYear(candidates, leagueData?.currentPayrollSeasonYear);

  // Saved roster labels such as "final rosters 25/26" should map to 2026.
  pushUniqueYear(candidates, getLeagueLabelPayrollYear(leagueData));

  // SalaryTable displays raw season + 1. Prefer the stable season markers before
  // any already-advanced runtime pointer, then include raw candidates as safety.
  pushUniqueYear(candidates, Number(leagueData?.seasonStartYear) + 1);
  pushUniqueYear(candidates, Number(leagueData?.seasonYear) + 1);
  pushUniqueYear(candidates, Number(leagueData?.currentSeasonYear) + 1);
  pushUniqueYear(candidates, leagueData?.seasonStartYear);
  pushUniqueYear(candidates, leagueData?.seasonYear);
  pushUniqueYear(candidates, leagueData?.currentSeasonYear);
  pushUniqueYear(candidates, 2026);

  const teams = getAllTeamsFromLeague(leagueData);
  const teamsWithStoredPayroll = teams
    .map((team) => ({ team, storedPayroll: getStoredTeamPayroll(team) }))
    .filter((row) => row.storedPayroll > 0);

  if (teamsWithStoredPayroll.length && candidates.length) {
    let best = null;

    for (const year of candidates) {
      const totalError = teamsWithStoredPayroll.reduce((sum, row) => {
        const rosterPayroll = getRosterPayrollForYear(row.team, year);
        return sum + Math.abs(rosterPayroll - row.storedPayroll);
      }, 0);

      if (!best || totalError < best.totalError) {
        best = { year, totalError };
      }
    }

    if (best) return best.year;
  }

  return candidates[0] || 2026;
}

function getPlayerSalary(player, leagueData) {
  return getSalaryForPayrollYear(player, getTradePayrollSeasonYear(leagueData));
}

function getContractYearsRemaining(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;

  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);
  let startYear = Number(contract.startYear || payrollSeasonYear);
  let idx = payrollSeasonYear - startYear;
  const hasPayrollSeasonSlot = idx >= 0 && idx < salaries.length;
  if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && !hasPayrollSeasonSlot) {
    startYear = payrollSeasonYear;
    idx = 0;
  }
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= salaries.length) idx = salaries.length - 1;
  return Math.max(1, salaries.length - idx);
}

function getContractTotalRemaining(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => Number(value) || 0)
    : [];
  if (!salaries.length) return getPlayerSalary(player, leagueData);

  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);
  let startYear = Number(contract.startYear || payrollSeasonYear);
  let idx = payrollSeasonYear - startYear;
  const hasPayrollSeasonSlot = idx >= 0 && idx < salaries.length;
  if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && !hasPayrollSeasonSlot) {
    startYear = payrollSeasonYear;
    idx = 0;
  }
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= salaries.length) idx = salaries.length - 1;

  return salaries.slice(idx).reduce((sum, value) => sum + Number(value || 0), 0);
}

function formatMoney(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return "$0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

function safeReadBuilder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_BUILDER_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveBuilder(builder) {
  localStorage.setItem(TRADE_BUILDER_KEY, JSON.stringify(builder));
}


function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readOffseasonState() {
  return safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
}

function readSavedDraftLottery(seasonYear) {
  const saved = safeJSON(localStorage.getItem(DRAFT_LOTTERY_KEY), null);
  if (!saved || typeof saved !== "object") return null;
  if (Number(saved.seasonYear || seasonYear) !== Number(seasonYear)) return null;
  return saved;
}

function readSavedDraftState(seasonYear) {
  const saved = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
  if (!saved || typeof saved !== "object") return null;
  if (Number(saved.seasonYear || seasonYear) !== Number(seasonYear)) return null;
  return saved;
}

function writeSavedDraftLottery(nextLottery) {
  if (!nextLottery || typeof nextLottery !== "object") return;
  localStorage.setItem(DRAFT_LOTTERY_KEY, JSON.stringify(nextLottery));
}

function writeSavedDraftState(nextDraftState) {
  if (!nextDraftState || typeof nextDraftState !== "object") return;
  localStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(nextDraftState));
}

function readTradePhaseInfo(leagueData) {
  const seasonYear = getCurrentSeasonYear(leagueData);
  const offseasonState = readOffseasonState();
  const savedLottery = readSavedDraftLottery(seasonYear);
  const savedDraftState = readSavedDraftState(seasonYear);

  const draftOrder = getLockedDraftOrder(leagueData, seasonYear);
  const draftOrderLocked = draftOrder.length >= 60;
  const draftComplete = Boolean(
    (Number(offseasonState?.seasonYear || seasonYear) === Number(seasonYear) && offseasonState?.draftComplete) ||
      (Number(savedDraftState?.seasonYear || 0) === Number(seasonYear) && savedDraftState?.completed) ||
      (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed)
  );

  const inOffseason = Boolean(
    offseasonState?.inOffseason ||
      offseasonState?.offseason ||
      offseasonState?.active ||
      offseasonState?.started ||
      offseasonState?.retirementsComplete ||
      offseasonState?.teamOptionsComplete ||
      offseasonState?.draftLotteryComplete ||
      offseasonState?.draftComplete ||
      offseasonState?.rookieSigningsComplete ||
      offseasonState?.freeAgencyComplete ||
      offseasonState?.rosterFinalizationStarted ||
      savedLottery ||
      savedDraftState ||
      leagueData?.draftState?.draftLotteryComplete ||
      leagueData?.draftState?.draftOrder?.length
  );

  return {
    seasonYear,
    inOffseason,
    draftOrderLocked,
    draftComplete,
    draftInProgress: Boolean(savedDraftState && !savedDraftState.completed && Number(savedDraftState.currentPickIndex || 0) > 0),
    enforceRegularSeasonRosterLimits: !inOffseason,
  };
}

function getPickNumberFromAny(row = {}) {
  const n = Number(row.pick ?? row.pickNumber ?? row.overallPick ?? row.draftPickNumber ?? row.resolvedPickNumber ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getRoundFromAny(row = {}) {
  const explicit = Number(row.round || row.roundNum || row.pickRound || 0);
  if (explicit === 1 || explicit === 2) return explicit;
  const pickNumber = getPickNumberFromAny(row);
  return pickNumber && pickNumber <= 30 ? 1 : 2;
}

function getOriginalTeamFromAny(row = {}) {
  return row.originalTeam || row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.team || row.teamName || "";
}

function getOwnerTeamFromDraftRow(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.ownerTeam || row.owner || row.currentOwner || row.teamName || "";
}

function getLockedDraftOrder(leagueData, seasonYear = getCurrentSeasonYear(leagueData)) {
  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return direct;

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (Array.isArray(lotteryOrder) && lotteryOrder.length) return lotteryOrder;

  const savedLottery = readSavedDraftLottery(seasonYear);
  if (
    savedLottery &&
    savedLottery.firstRoundRevealed &&
    savedLottery.secondRoundRevealed &&
    Array.isArray(savedLottery?.result?.fullDraftOrder)
  ) {
    return savedLottery.result.fullDraftOrder;
  }

  return [];
}

function resolvedPickIdentityMatches(row = {}, pick = {}) {
  const rowPick = getPickNumberFromAny(row);
  const pickNumber = getPickNumberFromAny(pick);
  if (!rowPick || !pickNumber || rowPick !== pickNumber) return false;

  const rowRound = getRoundFromAny(row);
  const pickRound = getRoundFromAny(pick);
  if (Number(rowRound) !== Number(pickRound)) return false;

  const rowOriginal = getOriginalTeamFromAny(row);
  const pickOriginal = getOriginalTeamFromAny(pick);
  return !pickOriginal || sameTeamName(rowOriginal, pickOriginal);
}

function setDraftRowOwner(row = {}, toTeamName = "", leagueData = {}, tradeStamp = {}) {
  const toTeam = findTeamInLeague(leagueData, toTeamName);
  const ownerLogo = teamLogoOf(toTeam);
  return {
    ...row,
    teamName: toTeamName,
    ownerTeam: toTeamName,
    owner: toTeamName,
    currentOwner: toTeamName,
    ownerTeamName: toTeamName,
    currentOwnerTeamName: toTeamName,
    ownerLogo: ownerLogo || row.ownerLogo || "",
    currentOwnerTeamLogo: ownerLogo || row.currentOwnerTeamLogo || row.logo || "",
    logo: ownerLogo || row.logo || "",
    lastTrade: tradeStamp,
    tradeHistory: Array.isArray(row.tradeHistory) ? [...row.tradeHistory, tradeStamp] : [tradeStamp],
  };
}

function updateDraftOrderOwner(rows = [], pick = {}, fromTeamName = "", toTeamName = "", leagueData = {}, tradeStamp = {}) {
  let found = false;
  let ownedByFrom = false;
  let label = formatPick(pick);

  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!resolvedPickIdentityMatches(row, pick)) return row;

    found = true;
    const currentOwner = getOwnerTeamFromDraftRow(row);
    if (!sameTeamName(currentOwner, fromTeamName)) return row;

    ownedByFrom = true;
    label = `#${getPickNumberFromAny(row)} ${formatPick({ ...pick, originalTeam: getOriginalTeamFromAny(row) })}`;
    return setDraftRowOwner(row, toTeamName, leagueData, tradeStamp);
  });

  return { rows: nextRows, found, ownedByFrom, label };
}

function isResolvedPickAlreadyDrafted(pick = {}, seasonYear = 2026) {
  const savedDraftState = readSavedDraftState(seasonYear);
  if (!savedDraftState || typeof savedDraftState !== "object") return false;
  if (savedDraftState.completed) return true;

  const pickNumber = getPickNumberFromAny(pick);
  const pickRound = getRoundFromAny(pick);
  const drafted = Array.isArray(savedDraftState.draftedPicks) ? savedDraftState.draftedPicks : [];

  if (drafted.some((row) => getPickNumberFromAny(row) === pickNumber && getRoundFromAny(row) === pickRound)) {
    return true;
  }

  const order = Array.isArray(savedDraftState.draftOrder) ? savedDraftState.draftOrder : [];
  const index = order.findIndex((row) => resolvedPickIdentityMatches(row, pick));
  const currentPickIndex = Number(savedDraftState.currentPickIndex || 0);
  return index >= 0 && currentPickIndex > index;
}

function readTradeDeadlineStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_DEADLINE_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isTradeDeadlineLocked(status) {
  return Boolean(status?.locked);
}

function makeEmptyBuilder(userTeamName, cpuTeamName) {
  return {
    userTeamName,
    cpuTeamName,
    userItems: [],
    cpuItems: [],
    updatedAt: Date.now(),
  };
}

function itemKey(item) {
  if (!item) return "";
  if (item.type === "player") {
    return `player:${item.player?.id || item.player?.playerId || playerNameOf(item.player)}`;
  }
  if (item.type === "pick") {
    const pick = item.pick || {};
    const rule = item.tradeRule || pick.tradeRule || {};
    if (rule.swapId) return `swap:${rule.swapId}:${rule.mirror ? "mirror" : "primary"}`;
    return `pick:${pick.id || pick.pickId || `${pick.year}_${pick.round}_${pick.originalTeam || pick.team || pick.owner || ""}`}`;
  }
  return `${item.type}:${JSON.stringify(item)}`;
}

function isSwapTradeItem(item = {}) {
  if (item?.type !== "pick") return false;
  const rule = item.tradeRule || item.pick?.tradeRule || {};
  return String(rule.action || "").toLowerCase() === "swap" || Boolean(rule.swapId);
}

function stripSwapTradeItems(items = []) {
  return (items || []).filter((item) => !isSwapTradeItem(item));
}

function getSideItems(builder, side) {
  return side === "user" ? builder.userItems || [] : builder.cpuItems || [];
}

function setSideItems(builder, side, nextItems) {
  if (side === "user") return { ...builder, userItems: nextItems, updatedAt: Date.now() };
  return { ...builder, cpuItems: nextItems, updatedAt: Date.now() };
}


function getTradeItemRound(item = {}) {
  if (item?.type !== "pick") return 0;
  const pick = item.pick || item || {};
  const round = Number(pick.round || pick.rnd || pick.pickRound || 0);
  if (round === 1 || round === 2) return round;
  const pickNumber = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.pick || 0);
  return pickNumber && pickNumber <= 30 ? 1 : 2;
}

function getTradeItemYear(item = {}) {
  const pick = item?.pick || item || {};
  const year = Number(pick.year || pick.seasonYear || pick.season || 9999);
  return Number.isFinite(year) ? year : 9999;
}

function getTradeItemOriginalTeamLabel(item = {}) {
  const pick = item?.pick || item || {};
  return String(pick.originalTeam || pick.originalTeamName || pick.team || pick.teamName || item.displayLabel || "");
}

function sortTradeItemsForDisplay(items = []) {
  return [...(items || [])].sort((a, b) => {
    const aIsPlayer = a?.type === "player";
    const bIsPlayer = b?.type === "player";
    if (aIsPlayer || bIsPlayer) {
      if (aIsPlayer && !bIsPlayer) return -1;
      if (!aIsPlayer && bIsPlayer) return 1;
      const aOvr = Number(a?.player?.overall ?? a?.player?.ovr ?? 0);
      const bOvr = Number(b?.player?.overall ?? b?.player?.ovr ?? 0);
      return bOvr - aOvr || playerNameOf(a?.player).localeCompare(playerNameOf(b?.player));
    }

    const aRound = getTradeItemRound(a);
    const bRound = getTradeItemRound(b);
    const aGroup = aRound === 1 ? 1 : aRound === 2 ? 2 : 3;
    const bGroup = bRound === 1 ? 1 : bRound === 2 ? 2 : 3;

    return (
      aGroup - bGroup ||
      getTradeItemYear(a) - getTradeItemYear(b) ||
      getTradeItemOriginalTeamLabel(a).localeCompare(getTradeItemOriginalTeamLabel(b)) ||
      String(a?.displayLabel || "").localeCompare(String(b?.displayLabel || ""))
    );
  });
}

function sideSalary(items, leagueData) {
  return (items || []).reduce((sum, item) => {
    if (item?.type !== "player") return sum;
    return sum + getPlayerSalary(item.player, leagueData);
  }, 0);
}

function getLeagueAmount(leagueData, rules, keys, fallback = 0) {
  for (const key of keys) {
    const value = Number(leagueData?.[key] || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const fallbackValue = Number(fallback || 0);
  return Number.isFinite(fallbackValue) ? fallbackValue : 0;
}

function getFinancialLimits(leagueData) {
  const seasonYear = getTradePayrollSeasonYear(leagueData);
  const rules = getLeagueFinancialRules(leagueData || {}, seasonYear);
  const salaryCap = getLeagueAmount(leagueData, rules, ["salaryCap", "capLimit"], rules.salaryCap);
  const firstApron = getLeagueAmount(leagueData, rules, ["firstApron", "apron1"], rules.firstApron || salaryCap);
  const secondApron = getLeagueAmount(leagueData, rules, ["secondApron", "apron2"], rules.secondApron || firstApron);
  const hardCap = getLeagueAmount(
    leagueData,
    rules,
    ["hardCap", "hardCapLimit", "secondApron", "apron2"],
    rules.hardCap || rules.secondApron || secondApron || salaryCap
  );
  const inflationIndex = Number(rules.inflationIndex || 1);

  return { salaryCap, firstApron, secondApron, hardCap, inflationIndex, seasonYear };
}

function getCurrentDeadCapForTeam(team, leagueData) {
  const teamName = team?.name;
  const seasonYear = getTradePayrollSeasonYear(leagueData);
  const rows = Array.isArray(leagueData?.deadCapByTeam?.[teamName])
    ? leagueData.deadCapByTeam[teamName]
    : [];

  return rows.reduce((sum, row) => {
    const rowSeason = Number(row?.seasonYear || seasonYear);
    if (rowSeason !== Number(seasonYear)) return sum;
    return sum + Number(row?.amount ?? row?.netAmount ?? row?.originalAmount ?? 0);
  }, 0);
}

function getTeamBasePayroll(team, leagueData) {
  const standardPlayers = Array.isArray(team?.players) ? team.players : [];
  const rosterPayroll = standardPlayers.reduce(
    (sum, player) => sum + getPlayerSalary(player, leagueData),
    0
  );
  const deadCap = getCurrentDeadCapForTeam(team, leagueData);
  const computedPayroll = rosterPayroll + deadCap;

  if (computedPayroll > 0) return computedPayroll;

  const storedPayroll = Number(team?.payroll ?? team?.totalSalary ?? team?.financials?.payroll ?? 0);
  return Number.isFinite(storedPayroll) ? storedPayroll : 0;
}

function getTeamCapInfo(team, leagueData, outgoingSalary = 0, incomingSalary = 0) {
  const limits = getFinancialLimits(leagueData);
  const { salaryCap, firstApron, secondApron, hardCap } = limits;
  const basePayroll = getTeamBasePayroll(team, leagueData);
  const payroll = Math.max(0, basePayroll - Number(outgoingSalary || 0) + Number(incomingSalary || 0));
  const capRoom = salaryCap > 0 ? salaryCap - payroll : Number(team?.capRoom ?? team?.financials?.capRoom ?? 0);
  const firstApronRoom = firstApron > 0 ? firstApron - payroll : 0;
  const secondApronRoom = secondApron > 0 ? secondApron - payroll : 0;
  const hardCapRoom = hardCap > 0 ? hardCap - payroll : Number(team?.hardCapRoom ?? team?.financials?.hardCapRoom ?? 0);

  return {
    capRoom,
    firstApronRoom,
    secondApronRoom,
    hardCapRoom,
    payroll,
    basePayroll,
    salaryCap,
    firstApron,
    secondApron,
    hardCap,
    seasonYear: limits.seasonYear,
  };
}

function scaledTradeMatchingAmount(amount, leagueData) {
  const { inflationIndex } = getFinancialLimits(leagueData);
  return Number(amount || 0) * Math.max(0.5, Number(inflationIndex || 1));
}

function getBelowApronMatchingLimit(outgoingSalary, leagueData) {
  const outgoing = Number(outgoingSalary || 0);
  const smallBand = scaledTradeMatchingAmount(TRADE_MATCHING_SMALL_OUTGOING, leagueData);
  const midBand = scaledTradeMatchingAmount(TRADE_MATCHING_MID_OUTGOING, leagueData);
  const buffer = scaledTradeMatchingAmount(TRADE_MATCHING_BUFFER, leagueData);

  if (outgoing <= 0) return 0;
  if (outgoing <= smallBand) return outgoing * 2 + buffer;
  if (outgoing <= midBand) return outgoing + smallBand;
  return outgoing * 1.25 + buffer;
}

function evaluateTradeFinancialLegality({ team, leagueData, outgoingSalary = 0, incomingSalary = 0 }) {
  const teamName = team?.name || team?.teamName || "This team";
  const outgoing = Number(outgoingSalary || 0);
  const incoming = Number(incomingSalary || 0);
  const cap = getTeamCapInfo(team, leagueData, outgoing, incoming);
  const basePayroll = Number(cap.basePayroll || 0);
  const projectedPayroll = Number(cap.payroll || 0);
  const netSalary = incoming - outgoing;
  const capRoomBefore = Math.max(0, Number(cap.salaryCap || 0) - basePayroll);
  const firstApron = Number(cap.firstApron || 0);
  const atOrAboveFirstApron = firstApron > 0 && basePayroll >= firstApron - TRADE_SALARY_TOLERANCE;
  const projectedAtOrAboveFirstApron = firstApron > 0 && projectedPayroll >= firstApron - TRADE_SALARY_TOLERANCE;

  const baseRows = [
    { label: "Current payroll", value: formatMoney(basePayroll) },
    { label: "Outgoing salary", value: formatMoney(outgoing) },
    { label: "Incoming salary", value: formatMoney(incoming) },
    { label: "Net salary change", value: formatMoney(netSalary) },
    { label: "Projected payroll", value: formatMoney(projectedPayroll) },
    { label: "Salary cap", value: formatMoney(cap.salaryCap) },
    { label: "First apron", value: formatMoney(cap.firstApron) },
    { label: "Second apron", value: formatMoney(cap.secondApron) },
  ];

  if (incoming <= outgoing + TRADE_SALARY_TOLERANCE) {
    return {
      ok: true,
      cap,
      title: `${teamName} Trade Salary Valid`,
      message: `${teamName} is not taking back more current-season salary than it sends out.`,
      rows: baseRows,
      statusLabel: "Valid Trade",
    };
  }

  if (atOrAboveFirstApron) {
    return {
      ok: false,
      cap,
      title: `${teamName} Apron Salary Issue`,
      message: `${teamName} is at/above the first apron and cannot take back more salary than it sends out.`,
      rows: baseRows,
      statusLabel: "Apron Issue",
    };
  }

  if (basePayroll < Number(cap.salaryCap || 0) && incoming <= outgoing + capRoomBefore + TRADE_SALARY_TOLERANCE) {
    return {
      ok: true,
      cap,
      title: `${teamName} Trade Salary Valid`,
      message: `${teamName} can absorb the added salary using cap room.`,
      rows: [...baseRows, { label: "Cap room before trade", value: formatMoney(capRoomBefore) }],
      statusLabel: "Valid Trade",
    };
  }

  const matchingLimit = getBelowApronMatchingLimit(outgoing, leagueData);
  const withinMatching = incoming <= matchingLimit + TRADE_SALARY_TOLERANCE;

  if (withinMatching && !projectedAtOrAboveFirstApron) {
    return {
      ok: true,
      cap,
      title: `${teamName} Trade Salary Valid`,
      message: `${teamName} is using below-apron salary matching.`,
      rows: [...baseRows, { label: "Max incoming by matching", value: formatMoney(matchingLimit) }],
      statusLabel: "Valid Trade",
    };
  }

  return {
    ok: false,
    cap,
    title: `${teamName} Salary Match Issue`,
    message: withinMatching
      ? `${teamName} would use extra salary matching while ending at/above the first apron.`
      : `${teamName} can take back up to ${formatMoney(matchingLimit)} based on the outgoing salary in this trade.`,
    rows: [...baseRows, { label: "Max incoming by matching", value: formatMoney(matchingLimit) }],
    statusLabel: withinMatching ? "Apron Issue" : "Salary Match Issue",
  };
}

function formatPick(pick) {
  if (!pick) return "Unknown Pick";
  const year = pick.year || pick.season || pick.seasonYear || "Future";
  const round = Number(pick.round || pick.rnd || 1);
  const original = pick.originalTeam || pick.original || pick.team || pick.fromTeam || pick.owner || "Own";
  const suffix = round === 1 ? "1st" : round === 2 ? "2nd" : `R${round}`;
  return `${year} ${suffix} - ${original}`;
}

function getPickOriginalTeamName(pick = {}) {
  return (
    pick?.originalTeam ||
    pick?.originalTeamName ||
    pick?.original ||
    pick?.fromTeam ||
    pick?.sourceTeam ||
    pick?.team ||
    ""
  );
}

function getPickOriginalTeamLogoTeam(leagueData, pick = {}, fallbackTeam = null) {
  const originalTeamName = getPickOriginalTeamName(pick);
  const directOriginalLogo =
    pick?.originalTeamLogo ||
    pick?.originalLogo ||
    pick?.fromTeamLogo ||
    pick?.sourceTeamLogo ||
    "";

  if (directOriginalLogo) {
    return {
      ...(fallbackTeam || {}),
      name: originalTeamName || fallbackTeam?.name || fallbackTeam?.teamName || "Original Team",
      logo: directOriginalLogo,
    };
  }

  if (originalTeamName) {
    const originalTeam = findTeamInLeague(leagueData, originalTeamName);
    if (originalTeam) return originalTeam;
  }

  return fallbackTeam;
}

function getTradePlayers(items) {
  return (items || [])
    .filter((item) => item?.type === "player" && item.player)
    .map((item) => item.player);
}

function getTradePicks(items, leagueData = null) {
  const seasonYear = getCurrentSeasonYear(leagueData || {});
  return (items || [])
    .filter((item) => item?.type === "pick" && item.pick && !item.tradeValueExcluded && !item.tradeRule?.mirror)
    .map((item) => {
      const pick = item.pick || {};
      const pickNumber = getPickNumberFromAny(pick);
      const protection = item.protection || pick.protection || pick.protections || pick.displayProtection || "Unprotected";
      return {
        ...pick,
        pickNumber: pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pickNumber || undefined,
        overallPick: pick.overallPick || pick.pickNumber || pick.resolvedPickNumber || pickNumber || undefined,
        projectedRank: pick.projectedRank || pick.recordRank || pick.expectedRank || pick.slot || pickNumber || undefined,
        currentSeasonYear: seasonYear,
        leagueSeasonYear: seasonYear,
        protection,
        protections: protection,
        displayProtection: protection,
        tradeRule: item.tradeRule || pick.tradeRule || undefined,
      };
    });
}

function readTeamRecord(team) {
  const wins = Number(
    team?.wins ??
      team?.record?.wins ??
      team?.seasonRecord?.wins ??
      team?.stats?.wins ??
      0
  );

  const losses = Number(
    team?.losses ??
      team?.record?.losses ??
      team?.seasonRecord?.losses ??
      team?.stats?.losses ??
      0
  );

  return {
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
  };
}

function averageTeamOverall(team) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const top = [...players]
    .map((player) => Number(player?.overall || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)
    .slice(0, 8);

  if (!top.length) return 0;
  return top.reduce((sum, value) => sum + value, 0) / top.length;
}

function inferTeamPhase(team) {
  const { wins, losses } = readTeamRecord(team);
  const games = wins + losses;
  const winPct = games > 0 ? wins / games : null;
  const avgOvr = averageTeamOverall(team);

  if (winPct !== null) {
    if (winPct >= 0.6) return "contender";
    if (winPct >= 0.5) return "playoff";
    if (winPct <= 0.35) return "rebuild";
    return "retool";
  }

  if (avgOvr >= 84) return "contender";
  if (avgOvr >= 80) return "playoff";
  if (avgOvr <= 75) return "rebuild";
  return "retool";
}

function buildTeamContextForTrade(userTeam, cpuTeam) {
  const context = {};

  for (const team of [userTeam, cpuTeam]) {
    if (!team?.name) continue;
    const { wins, losses } = readTeamRecord(team);
    context[team.name] = {
      wins,
      losses,
      phase: inferTeamPhase(team),
    };
  }

  return context;
}

function buildTradeProposalPayload({ userTeamName, cpuTeamName, userTeam, cpuTeam, userItems, cpuItems, leagueData }) {
  const seasonYear = getCurrentSeasonYear(leagueData || {});
  return {
    seasonYear,
    currentSeasonYear: seasonYear,
    userTeam: userTeamName,
    cpuTeam: cpuTeamName,
    teamContext: buildTeamContextForTrade(userTeam, cpuTeam),
    cpuReceives: {
      players: getTradePlayers(userItems),
      picks: getTradePicks(userItems, leagueData),
    },
    cpuSends: {
      players: getTradePlayers(cpuItems),
      picks: getTradePicks(cpuItems, leagueData),
    },
  };
}


function hasAcceptedEvaluation(evaluation) {
  return Boolean(
    evaluation?.accepted ||
      String(evaluation?.decision || "").toLowerCase() === "accept" ||
      String(evaluation?.decision || "").toLowerCase() === "accepted"
  );
}

function isTradeDebugEnabled() {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        (window.__BM_TRADE_DEBUG || localStorage.getItem(TRADE_DEBUG_KEY) === "1")
    );
  } catch {
    return false;
  }
}

function tradeDebugItemLabel(item = {}) {
  if (item?.type === "player") return playerNameOf(item.player);
  if (item?.type === "pick") return `${item.protection || item.pick?.displayProtection || item.pick?.protection || "Unprotected"} ${formatPick(item.pick || {})}`;
  return item?.label || item?.type || "Unknown asset";
}

function tradeDebugItems(items = [], leagueData = null) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.type === "player") {
      return {
        type: "player",
        name: playerNameOf(item.player),
        ovr: Number(item.player?.overall ?? item.player?.ovr ?? 0),
        pot: Number(item.player?.potential ?? item.player?.pot ?? item.player?.overall ?? 0),
        salaryM: Math.round((getPlayerSalary(item.player, leagueData) / 1_000_000) * 10) / 10,
      };
    }
    if (item?.type === "pick") {
      return {
        type: "pick",
        label: tradeDebugItemLabel(item),
        tradeRule: item.tradeRule || item.pick?.tradeRule || null,
      };
    }
    return { type: item?.type || "unknown", label: tradeDebugItemLabel(item) };
  });
}

function tradeDebugEvaluation(evaluation = {}) {
  const impact = evaluation?.teamImpact || {};
  const breakdown = impact?.scoreBreakdown || {};
  return {
    accepted: hasAcceptedEvaluation(evaluation),
    decision: evaluation?.decision || "",
    score: Number(evaluation?.score ?? 0),
    threshold: Number(impact?.threshold ?? 0),
    margin: Number(evaluation?.score ?? 0) - Number(impact?.threshold ?? 0),
    ratingMode: impact?.ratingMode || "",
    fastScan: Boolean(impact?.fastScan),
    fastFtr: Boolean(impact?.fastFtr),
    rank: impact?.rank,
    deltas: impact?.deltas || null,
    scoreBreakdown: impact?.scoreBreakdown || null,
    contractFriction: impact?.contractFriction ?? breakdown?.contractFriction,
    starRetentionTax: impact?.starRetentionTax ?? breakdown?.starRetentionTax,
    topReasons: Array.isArray(evaluation?.reasons) ? evaluation.reasons.slice(0, 12) : [],
  };
}

function debugProposeTradeEvaluation({ result, userTeamName, cpuTeamName, userItems, cpuItems, leagueData }) {
  if (!isTradeDebugEnabled()) return;

  const summary = tradeDebugEvaluation(result);
  const payload = {
    userTeam: userTeamName,
    cpuTeam: cpuTeamName,
    evaluation: summary,
    userPackage: tradeDebugItems(userItems, leagueData),
    cpuPackage: tradeDebugItems(cpuItems, leagueData),
  };

  if (summary.accepted) console.log("[TRADE DEBUG][BUILDER EVALUATION ACCEPT]", payload);
  else console.warn("[TRADE DEBUG][BUILDER EVALUATION REJECT]", payload);

  try {
    console.table([{ path: "Builder", ...summary }]);
  } catch {}
}

function cloneTeamForTrade(team = {}) {
  return {
    ...team,
    players: Array.isArray(team.players) ? team.players.map((player) => ({ ...player })) : [],
    twoWayPlayers: Array.isArray(team.twoWayPlayers)
      ? team.twoWayPlayers.map((player) => ({ ...player }))
      : [],
    stashPlayers: Array.isArray(team.stashPlayers)
      ? team.stashPlayers.map((player) => ({ ...player }))
      : [],
    financials: team.financials && typeof team.financials === "object" ? { ...team.financials } : team.financials,
  };
}

function cloneLeagueForTrade(leagueData = {}) {
  const next = {
    ...leagueData,
    draftPicks: Array.isArray(leagueData?.draftPicks)
      ? leagueData.draftPicks.map((pick) => ({ ...pick }))
      : [],
    tradeHistory: Array.isArray(leagueData?.tradeHistory) ? [...leagueData.tradeHistory] : [],
    draftState: leagueData?.draftState && typeof leagueData.draftState === "object"
      ? JSON.parse(JSON.stringify(leagueData.draftState))
      : leagueData?.draftState,
  };

  if (Array.isArray(leagueData?.teams)) {
    next.teams = leagueData.teams.map(cloneTeamForTrade);
  }

  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    next.conferences = Object.fromEntries(
      Object.entries(leagueData.conferences).map(([confName, rows]) => [
        confName,
        Array.isArray(rows) ? rows.map(cloneTeamForTrade) : rows,
      ])
    );
  }

  return next;
}

function sameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function findTeamInLeague(leagueData, teamName) {
  return getAllTeamsFromLeague(leagueData).find((team) => sameTeamName(team?.name || team?.teamName, teamName)) || null;
}

function getPlayerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null;
  if (id !== null && id !== undefined && String(id).trim() !== "") return `id:${String(id)}`;
  return `name:${normalizeTeamName(playerNameOf(player))}`;
}

function sameTradePlayer(a = {}, b = {}) {
  const aid = getPlayerIdentity(a);
  const bid = getPlayerIdentity(b);
  return aid && bid && aid === bid;
}

function findStandardPlayerIndex(team, player) {
  const rows = Array.isArray(team?.players) ? team.players : [];
  return rows.findIndex((row) => sameTradePlayer(row, player));
}

function transferStandardPlayer(nextLeague, fromTeamName, toTeamName, playerItem) {
  const fromTeam = findTeamInLeague(nextLeague, fromTeamName);
  const toTeam = findTeamInLeague(nextLeague, toTeamName);
  const player = playerItem?.player || {};
  const playerName = playerNameOf(player);

  if (!fromTeam || !toTeam) {
    return { ok: false, reason: `Could not find ${!fromTeam ? fromTeamName : toTeamName} in the league save.` };
  }

  if (player?.isTwoWay || player?.isStash) {
    return {
      ok: false,
      reason: `${playerName} is not a standard-roster player. Trade execution currently supports standard roster players only.`,
    };
  }

  const fromIndex = findStandardPlayerIndex(fromTeam, player);
  if (fromIndex < 0) {
    return { ok: false, reason: `${playerName} is no longer on ${fromTeamName}'s standard roster.` };
  }

  const [movedRaw] = fromTeam.players.splice(fromIndex, 1);
  const moved = {
    ...movedRaw,
    isTwoWay: false,
    isStash: false,
    rosterStatus: movedRaw?.rosterStatus === "free_agent" ? "standard" : movedRaw?.rosterStatus,
  };

  if (moved.teamName !== undefined) moved.teamName = toTeamName;
  if (moved.currentTeam !== undefined) moved.currentTeam = toTeamName;
  if (typeof moved.team === "string") moved.team = toTeamName;

  toTeam.players = (Array.isArray(toTeam.players) ? toTeam.players : []).filter((row) => !sameTradePlayer(row, moved));
  toTeam.players.push(moved);

  return { ok: true, playerName };
}

function getTeamNamesForDraftPickMatch(leagueData) {
  return getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
}

function pickIdentityMatches(normalizedRow = {}, targetPick = {}, fromTeamName = "") {
  const normalizedTarget = {
    ...targetPick,
    assetType: String(targetPick?.assetType || targetPick?.type || "pick").toLowerCase(),
    type: String(targetPick?.assetType || targetPick?.type || "pick").toLowerCase(),
  };

  const targetId = String(targetPick?.id || targetPick?.pickId || "");
  if (targetId && String(normalizedRow.id || "") === targetId) return true;

  const sameCore =
    String(normalizedRow.assetType || normalizedRow.type || "pick").toLowerCase() ===
      String(normalizedTarget.assetType || normalizedTarget.type || "pick").toLowerCase() &&
    Number(normalizedRow.year || 0) === Number(normalizedTarget.year || normalizedTarget.seasonYear || 0) &&
    Number(normalizedRow.round || 0) === Number(normalizedTarget.round || 0) &&
    sameTeamName(normalizedRow.originalTeam, normalizedTarget.originalTeam || normalizedTarget.originalTeamName);

  if (!sameCore) return false;

  const targetOwner = normalizedTarget.ownerTeam || normalizedTarget.owner || normalizedTarget.currentOwnerTeamName || fromTeamName;
  return sameTeamName(normalizedRow.ownerTeam, targetOwner) || sameTeamName(normalizedRow.ownerTeam, fromTeamName);
}

function pickRuleOf(pickItem = {}) {
  return pickItem.tradeRule || pickItem.pick?.tradeRule || {};
}

function getPickDisplayProtection(item = {}) {
  return item.protection || item.pick?.displayProtection || item.pick?.protections || item.pick?.protection || "Unprotected";
}

function makeOwnedRangeFields(range = null) {
  if (!range) return {};
  return {
    ownedSlots: { start: Number(range.start), end: Number(range.end) },
    ownedRange: { start: Number(range.start), end: Number(range.end) },
  };
}

function rebuildProtectedSplitRow({ sourceRow = {}, normalized = {}, ownerTeam, ownerLogo = "", range, baseProtectionLabel, tradeStamp, seedKind }) {
  const year = Number(normalized.year || sourceRow.year || 0);
  const round = Number(normalized.round || sourceRow.round || 1);
  const originalTeam = normalized.originalTeam || sourceRow.originalTeam || sourceRow.originalTeamName || "";
  const displayProtection = protectionDisplayForOwnedRange(baseProtectionLabel, range);

  return normalizeDraftPickAsset({
    ...sourceRow,
    id: makeTradeGeneratedDraftPickId({
      year,
      round,
      originalTeam,
      ownerTeam,
      kind: seedKind || "protected",
      range,
    }),
    assetType: "pick",
    type: "pick",
    year,
    round,
    originalTeam,
    originalTeamName: originalTeam,
    ownerTeam,
    owner: ownerTeam,
    currentOwner: ownerTeam,
    currentOwnerTeamName: ownerTeam,
    ownerTeamName: ownerTeam,
    teamName: ownerTeam,
    ownerLogo: ownerLogo || sourceRow.ownerLogo || "",
    currentOwnerTeamLogo: ownerLogo || sourceRow.currentOwnerTeamLogo || "",
    logo: ownerLogo || sourceRow.logo || "",
    protection: baseProtectionLabel,
    protections: baseProtectionLabel,
    displayProtection,
    protectionType: "protected_range",
    logicType: "trade_machine_protected_split",
    status: sourceRow.status || "active",
    ...makeOwnedRangeFields(range),
    lastTrade: tradeStamp,
    tradeHistory: Array.isArray(sourceRow.tradeHistory)
      ? [...sourceRow.tradeHistory, tradeStamp]
      : [tradeStamp],
  });
}

function transferProtectedDraftPick(nextLeague, fromTeamName, toTeamName, pickItem, rowIndex, normalized) {
  const rows = Array.isArray(nextLeague?.draftPicks) ? nextLeague.draftPicks : [];
  const rule = pickRuleOf(pickItem);
  const pick = pickItem?.pick || {};
  const validation = validateCustomPickProtection(
    normalized,
    rule.protectStart ?? rule.retainedRange?.start ?? rule.ownedRange?.start,
    rule.protectEnd ?? rule.retainedRange?.end
  );

  if (!validation.ok) return { ok: false, reason: validation.reason };

  const fromTeam = findTeamInLeague(nextLeague, fromTeamName);
  const toTeam = findTeamInLeague(nextLeague, toTeamName);
  const fromLogo = teamLogoOf(fromTeam);
  const toLogo = teamLogoOf(toTeam);
  const baseProtectionLabel = rule.baseProtectionLabel || validation.baseProtectionLabel;
  const tradeStamp = {
    fromTeam: fromTeamName,
    toTeam: toTeamName,
    protection: baseProtectionLabel,
    retainedRange: validation.retainedRange,
    conveyedRange: validation.conveyedRange,
    seasonYear: getCurrentSeasonYear(nextLeague),
    completedAt: new Date().toISOString(),
    action: "protected_split",
  };

  const retainedRow = rebuildProtectedSplitRow({
    sourceRow: rows[rowIndex],
    normalized,
    ownerTeam: fromTeamName,
    ownerLogo: fromLogo,
    range: validation.retainedRange,
    baseProtectionLabel,
    tradeStamp,
    seedKind: "retain",
  });
  const conveyedRow = rebuildProtectedSplitRow({
    sourceRow: rows[rowIndex],
    normalized,
    ownerTeam: toTeamName,
    ownerLogo: toLogo,
    range: validation.conveyedRange,
    baseProtectionLabel,
    tradeStamp,
    seedKind: "convey",
  });

  rows.splice(rowIndex, 1, retainedRow, conveyedRow);

  return {
    ok: true,
    pickLabel: `${baseProtectionLabel} ${formatPick(pick)} (${toTeamName} owns ${validation.conveyedRange.start}-${validation.conveyedRange.end})`,
  };
}

function transferSwapDraftPick(nextLeague, fromTeamName, toTeamName, pickItem) {
  const rule = pickRuleOf(pickItem);
  if (rule.mirror || pickItem.tradeValueExcluded || pickItem.displayOnlyLinkedSwap) {
    return { ok: true, pickLabel: pickItem.displayLabel || `${getPickDisplayProtection(pickItem)} ${formatPick(pickItem.pick)}` };
  }

  const sourcePick = rule.sourcePick || pickItem.pick || {};
  const swapPick = rule.swapPick || {};
  if (!sourcePick?.year || !swapPick?.year) {
    return { ok: false, reason: "This swap is missing one of the linked picks." };
  }
  if (Number(sourcePick.year) !== Number(swapPick.year) || Number(sourcePick.round || 1) !== Number(swapPick.round || 1)) {
    return { ok: false, reason: "Swap picks must be in the same year and round." };
  }

  const teamNames = getTeamNamesForDraftPickMatch(nextLeague);
  const rows = Array.isArray(nextLeague?.draftPicks) ? nextLeague.draftPicks : [];
  const sourceRow = rows.find((row, rowIndex) => pickIdentityMatches(normalizeDraftPickAsset(row, rowIndex, teamNames), sourcePick, fromTeamName));
  const swapRow = rows.find((row, rowIndex) => pickIdentityMatches(normalizeDraftPickAsset(row, rowIndex, teamNames), swapPick, toTeamName));
  if (!sourceRow) return { ok: false, reason: `Could not find ${formatPick(sourcePick)} for the swap.` };
  if (!swapRow) return { ok: false, reason: `Could not find ${formatPick(swapPick)} for the swap.` };

  const normalizedSource = normalizeDraftPickAsset(sourceRow, 0, teamNames);
  const normalizedSwap = normalizeDraftPickAsset(swapRow, 0, teamNames);
  if (!sameTeamName(normalizedSource.ownerTeam, fromTeamName)) {
    return { ok: false, reason: `${fromTeamName} no longer owns ${formatPick(sourcePick)}.` };
  }
  if (!sameTeamName(normalizedSwap.ownerTeam, toTeamName)) {
    return { ok: false, reason: `${toTeamName} no longer owns ${formatPick(swapPick)}.` };
  }

  if (!canCreateSwapWithPick(normalizedSource)) {
    return { ok: false, reason: `${formatPick(normalizedSource)} cannot be used in a new swap because it is not a full unprotected normal pick.` };
  }
  if (!canCreateSwapWithPick(normalizedSwap)) {
    return { ok: false, reason: `${formatPick(normalizedSwap)} cannot be used in a new swap because it is not a full unprotected normal pick.` };
  }

  const sourceConflictKey = getDraftPickConflictKey(normalizedSource, nextLeague);
  const swapConflictKey = getDraftPickConflictKey(normalizedSwap, nextLeague);
  if (!sourceConflictKey || !swapConflictKey || sourceConflictKey === swapConflictKey) {
    return { ok: false, reason: "A swap must use two different original picks in the same year and round." };
  }

  const sourceEncumbrance = getDraftPickEncumbranceReason(normalizedSource, rows, nextLeague);
  if (sourceEncumbrance) return { ok: false, reason: sourceEncumbrance };

  const swapEncumbrance = getDraftPickEncumbranceReason(normalizedSwap, rows, nextLeague);
  if (swapEncumbrance) return { ok: false, reason: swapEncumbrance };

  const tradeStamp = {
    fromTeam: fromTeamName,
    toTeam: toTeamName,
    protection: rule.swapDirection === "worst" ? "Swap Worst" : "Swap Best",
    seasonYear: getCurrentSeasonYear(nextLeague),
    completedAt: new Date().toISOString(),
    action: "swap_right",
    swapId: rule.swapId || null,
  };

  const swapAssets = buildTradeMachineSwapAssets({
    sourcePick: normalizedSource,
    swapPick: normalizedSwap,
    fromTeamName,
    toTeamName,
    direction: rule.swapDirection || "best",
    tradeStamp,
  });

  const cleanedRows = removeDirectPickRowsConsumedBySwap(rows, normalizedSource, normalizedSwap, nextLeague);
  rows.splice(0, rows.length, ...cleanedRows);

  const existingIds = new Set(rows.map((row) => String(row.id || "")));
  for (const asset of swapAssets) {
    if (!existingIds.has(String(asset.id || ""))) {
      rows.push(asset);
      existingIds.add(String(asset.id || ""));
    }
  }

  return {
    ok: true,
    pickLabel: pickItem.displayLabel || `${tradeStamp.protection} ${formatPick(sourcePick)} / ${formatPick(swapPick)}`,
  };
}


function transferResolvedDraftPick(nextLeague, fromTeamName, toTeamName, pickItem) {
  const pick = pickItem?.pick || {};
  const seasonYear = Number(pick.year || pick.seasonYear || getCurrentSeasonYear(nextLeague));
  const phaseInfo = readTradePhaseInfo(nextLeague);

  if (phaseInfo.draftComplete) {
    return { ok: false, reason: `${formatPick(pick)} cannot be traded because the draft is already complete.` };
  }

  if (isResolvedPickAlreadyDrafted(pick, seasonYear)) {
    return { ok: false, reason: `${formatPick(pick)} has already been used in the draft and cannot be traded as a pick.` };
  }

  const tradeStamp = {
    fromTeam: fromTeamName,
    toTeam: toTeamName,
    protection: "Resolved",
    seasonYear,
    completedAt: new Date().toISOString(),
    assetType: "resolved",
    pickNumber: getPickNumberFromAny(pick),
  };

  let found = false;
  let ownedByFrom = false;
  let pickLabel = formatPick(pick);

  const applyToRows = (rows) => {
    const result = updateDraftOrderOwner(rows, pick, fromTeamName, toTeamName, nextLeague, tradeStamp);
    found = found || result.found;
    ownedByFrom = ownedByFrom || result.ownedByFrom;
    pickLabel = result.label || pickLabel;
    return result.rows;
  };

  if (!nextLeague.draftState || typeof nextLeague.draftState !== "object") {
    nextLeague.draftState = { seasonYear };
  }

  if (Array.isArray(nextLeague.draftState.draftOrder) && nextLeague.draftState.draftOrder.length) {
    nextLeague.draftState.draftOrder = applyToRows(nextLeague.draftState.draftOrder);
  }

  if (Array.isArray(nextLeague.draftState?.lottery?.fullDraftOrder) && nextLeague.draftState.lottery.fullDraftOrder.length) {
    nextLeague.draftState.lottery = {
      ...nextLeague.draftState.lottery,
      fullDraftOrder: applyToRows(nextLeague.draftState.lottery.fullDraftOrder),
    };
  }

  const savedLottery = readSavedDraftLottery(seasonYear);
  if (savedLottery?.result?.fullDraftOrder?.length) {
    const nextFullDraftOrder = applyToRows(savedLottery.result.fullDraftOrder);
    const nextLottery = {
      ...savedLottery,
      result: {
        ...savedLottery.result,
        fullDraftOrder: nextFullDraftOrder,
        firstRoundOrder: Array.isArray(savedLottery.result.firstRoundOrder)
          ? applyToRows(savedLottery.result.firstRoundOrder)
          : savedLottery.result.firstRoundOrder,
        secondRoundOrder: Array.isArray(savedLottery.result.secondRoundOrder)
          ? applyToRows(savedLottery.result.secondRoundOrder)
          : savedLottery.result.secondRoundOrder,
      },
    };
    writeSavedDraftLottery(nextLottery);

    if (!Array.isArray(nextLeague.draftState.draftOrder) || !nextLeague.draftState.draftOrder.length) {
      nextLeague.draftState.draftOrder = nextFullDraftOrder;
    }
    nextLeague.draftState.lottery = {
      ...(nextLeague.draftState.lottery || {}),
      ...(nextLottery.result || {}),
      fullDraftOrder: nextFullDraftOrder,
    };
  }

  const savedDraftState = readSavedDraftState(seasonYear);
  if (savedDraftState?.draftOrder?.length) {
    const nextDraftState = {
      ...savedDraftState,
      draftOrder: applyToRows(savedDraftState.draftOrder),
    };
    writeSavedDraftState(nextDraftState);
  }

  if (!found) {
    return { ok: false, reason: `Could not find ${formatPick(pick)} in the locked draft order.` };
  }

  if (!ownedByFrom) {
    return { ok: false, reason: `${fromTeamName} no longer owns ${formatPick(pick)}.` };
  }

  return { ok: true, pickLabel };
}

function transferDraftPick(nextLeague, fromTeamName, toTeamName, pickItem) {
  const rows = Array.isArray(nextLeague?.draftPicks) ? nextLeague.draftPicks : [];
  const pick = pickItem?.pick || {};
  const rule = pickRuleOf(pickItem);
  const type = String(pick?.assetType || pick?.type || "pick").toLowerCase();

  if (rule.action === "swap") {
    return transferSwapDraftPick(nextLeague, fromTeamName, toTeamName, pickItem);
  }

  if (type === "resolved") {
    return transferResolvedDraftPick(nextLeague, fromTeamName, toTeamName, pickItem);
  }

  const teamNames = getTeamNamesForDraftPickMatch(nextLeague);
  const index = rows.findIndex((row, rowIndex) => {
    const normalized = normalizeDraftPickAsset(row, rowIndex, teamNames);
    return pickIdentityMatches(normalized, pick, fromTeamName);
  });

  if (index < 0) {
    return { ok: false, reason: `Could not find ${formatPick(pick)} in leagueData.draftPicks.` };
  }

  const normalized = normalizeDraftPickAsset(rows[index], index, teamNames);
  if (!sameTeamName(normalized.ownerTeam, fromTeamName)) {
    return {
      ok: false,
      reason: `${fromTeamName} no longer owns ${formatPick(normalized)}. Current owner is ${normalized.ownerTeam}.`,
    };
  }

  const encumbranceReason = getDraftPickEncumbranceReason(normalized, rows, nextLeague, { ignoreAssetIds: [normalized.id] });
  if (encumbranceReason) {
    return { ok: false, reason: encumbranceReason };
  }

  if (rule.action === "protected") {
    return transferProtectedDraftPick(nextLeague, fromTeamName, toTeamName, pickItem, index, normalized);
  }

  const toTeam = findTeamInLeague(nextLeague, toTeamName);
  const ownerLogo = teamLogoOf(toTeam);
  const protection = getPickDisplayProtection(pickItem) || normalized.displayProtection || normalized.protections || "Unprotected";
  const ownedRange = getTradeablePickOwnedRange(normalized);
  const tradeStamp = {
    fromTeam: fromTeamName,
    toTeam: toTeamName,
    protection,
    ownedRange,
    seasonYear: getCurrentSeasonYear(nextLeague),
    completedAt: new Date().toISOString(),
    action: "full_pick_transfer",
  };

  rows[index] = {
    ...rows[index],
    ownerTeam: toTeamName,
    owner: toTeamName,
    currentOwner: toTeamName,
    currentOwnerTeamName: toTeamName,
    ownerTeamName: toTeamName,
    teamName: toTeamName,
    ownerLogo: ownerLogo || rows[index]?.ownerLogo || "",
    currentOwnerTeamLogo: ownerLogo || rows[index]?.currentOwnerTeamLogo || "",
    logo: ownerLogo || rows[index]?.logo || "",
    protection,
    protections: protection,
    displayProtection: protection,
    status: rows[index]?.status || "active",
    lastTrade: tradeStamp,
    tradeHistory: Array.isArray(rows[index]?.tradeHistory)
      ? [...rows[index].tradeHistory, tradeStamp]
      : [tradeStamp],
  };

  return { ok: true, pickLabel: pickItem.displayLabel || formatPick({ ...normalized, protection }) };
}


function summarizeTradeItems(items = []) {
  const players = items
    .filter((item) => item?.type === "player")
    .map((item) => playerNameOf(item.player));
  const picks = items
    .filter((item) => item?.type === "pick")
    .map((item) => item.displayLabel || `${formatPick(item.pick)} (${item.protection || item.pick?.protection || "Unprotected"})`);
  return { players, picks };
}

function refreshTeamFinancialSnapshot(team, leagueData) {
  if (!team) return;
  const cap = getTeamCapInfo(team, leagueData, 0, 0);
  team.payroll = cap.payroll;
  team.totalSalary = cap.payroll;
  team.capRoom = cap.capRoom;
  team.hardCapRoom = cap.hardCapRoom;
  team.financials = {
    ...(team.financials && typeof team.financials === "object" ? team.financials : {}),
    payroll: cap.payroll,
    totalSalary: cap.payroll,
    capRoom: cap.capRoom,
    hardCapRoom: cap.hardCapRoom,
    firstApronRoom: cap.firstApronRoom,
    secondApronRoom: cap.secondApronRoom,
    salaryCap: cap.salaryCap,
    firstApron: cap.firstApron,
    secondApron: cap.secondApron,
    hardCap: cap.hardCap,
  };
}

function getUnsupportedRosterTradePlayer(items = []) {
  return (items || []).find((item) => {
    if (item?.type !== "player" || !item.player) return false;
    const player = item.player || {};
    const status = String(player.rosterStatus || player.contractType || "").toLowerCase();
    return Boolean(
      player.isTwoWay ||
        player.isStash ||
        status.includes("two_way") ||
        status.includes("two-way") ||
        status.includes("stash") ||
        status.includes("stashed")
    );
  }) || null;
}

function getProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  const current = getStandardRosterCount(team);
  const outgoingPlayers = countTradePlayers(outgoingItems);
  const incomingPlayers = countTradePlayers(incomingItems);
  const projected = current - outgoingPlayers + incomingPlayers;

  return {
    current,
    outgoingPlayers,
    incomingPlayers,
    projected,
  };
}

function validateProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  const teamName = team?.name || team?.teamName || "This team";
  const counts = getProjectedStandardRosterCount(team, outgoingItems, incomingItems);

  const allowedMax = Math.max(REGULAR_SEASON_MAX_STANDARD_PLAYERS, counts.current);
  if (counts.projected > allowedMax) {
    return {
      ok: false,
      reason: `Trade blocked: ${teamName} would have ${counts.projected} standard players after this trade. A team can temporarily reach ${REGULAR_SEASON_MAX_STANDARD_PLAYERS}, and teams already above that number cannot add more players.`,
      counts: { ...counts, allowedMax },
    };
  }

  return { ok: true, counts };
}

function validateRosterLimitsForTrade({ leagueData, userTeam, cpuTeam, userItems, cpuItems }) {
  const unsupportedUserPlayer = getUnsupportedRosterTradePlayer(userItems);
  if (unsupportedUserPlayer) {
    return {
      ok: false,
      reason: `${playerNameOf(unsupportedUserPlayer.player)} is not on the standard roster. Trade execution currently supports standard roster players only.`,
    };
  }

  const unsupportedCpuPlayer = getUnsupportedRosterTradePlayer(cpuItems);
  if (unsupportedCpuPlayer) {
    return {
      ok: false,
      reason: `${playerNameOf(unsupportedCpuPlayer.player)} is not on the standard roster. Trade execution currently supports standard roster players only.`,
    };
  }

  const phaseInfo = readTradePhaseInfo(leagueData);
  if (!phaseInfo.enforceRegularSeasonRosterLimits) {
    return {
      ok: true,
      offseasonRosterFlex: true,
      userRoster: getProjectedStandardRosterCount(userTeam, userItems, cpuItems),
      cpuRoster: getProjectedStandardRosterCount(cpuTeam, cpuItems, userItems),
    };
  }

  const userRoster = validateProjectedStandardRosterCount(userTeam, userItems, cpuItems);
  if (!userRoster.ok) return userRoster;

  const cpuRoster = validateProjectedStandardRosterCount(cpuTeam, cpuItems, userItems);
  if (!cpuRoster.ok) return cpuRoster;

  return {
    ok: true,
    userRoster: userRoster.counts,
    cpuRoster: cpuRoster.counts,
  };
}

function validateTradeForExecution({ leagueData, userTeam, cpuTeam, userItems, cpuItems, evaluation }) {
  if (!hasAcceptedEvaluation(evaluation)) {
    return { ok: false, reason: "CPU must accept the proposal before it can be submitted." };
  }

  if (!userTeam || !cpuTeam) {
    return { ok: false, reason: "Both teams must still exist in the league save." };
  }

  if (!userItems.length && !cpuItems.length) {
    return { ok: false, reason: "Add at least one trade asset before submitting." };
  }

  const userFinancial = evaluateTradeFinancialLegality({
    team: userTeam,
    leagueData,
    outgoingSalary: sideSalary(userItems, leagueData),
    incomingSalary: sideSalary(cpuItems, leagueData),
  });
  if (!userFinancial.ok) {
    return { ok: false, reason: userFinancial.message || `${userTeam.name} cannot complete this trade under the salary matching rules.` };
  }

  const cpuFinancial = evaluateTradeFinancialLegality({
    team: cpuTeam,
    leagueData,
    outgoingSalary: sideSalary(cpuItems, leagueData),
    incomingSalary: sideSalary(userItems, leagueData),
  });
  if (!cpuFinancial.ok) {
    return { ok: false, reason: cpuFinancial.message || `${cpuTeam.name} cannot complete this trade under the salary matching rules.` };
  }

  const rosterValidation = validateRosterLimitsForTrade({ leagueData, userTeam, cpuTeam, userItems, cpuItems });
  if (!rosterValidation.ok) return rosterValidation;

  return { ok: true };
}


function clearSavedGameplanForTeam(teamName = "") {
  if (!teamName) return;
  try {
    localStorage.removeItem(`gameplan_${teamName}`);
  } catch {}
}

function executeAcceptedTradeOnLeague({ leagueData, userTeamName, cpuTeamName, userItems, cpuItems, evaluation }) {
  const userTeam = findTeamInLeague(leagueData, userTeamName);
  const cpuTeam = findTeamInLeague(leagueData, cpuTeamName);
  const validation = validateTradeForExecution({ leagueData, userTeam, cpuTeam, userItems, cpuItems, evaluation });
  if (!validation.ok) return validation;

  const nextLeague = cloneLeagueForTrade(leagueData);
  const movedPlayers = [];
  const movedPicks = [];

  const playerMoves = [
    ...userItems.filter((item) => item?.type === "player").map((item) => ({ item, from: userTeamName, to: cpuTeamName })),
    ...cpuItems.filter((item) => item?.type === "player").map((item) => ({ item, from: cpuTeamName, to: userTeamName })),
  ];

  for (const move of playerMoves) {
    const result = transferStandardPlayer(nextLeague, move.from, move.to, move.item);
    if (!result.ok) return result;
    movedPlayers.push({ name: result.playerName, fromTeam: move.from, toTeam: move.to });
  }

  const pickMoves = [
    ...userItems.filter((item) => item?.type === "pick").map((item) => ({ item, from: userTeamName, to: cpuTeamName })),
    ...cpuItems.filter((item) => item?.type === "pick").map((item) => ({ item, from: cpuTeamName, to: userTeamName })),
  ];

  for (const move of pickMoves) {
    const result = transferDraftPick(nextLeague, move.from, move.to, move.item);
    if (!result.ok) return result;
    if (!move.item?.tradeRule?.mirror && !move.item?.tradeValueExcluded) {
      movedPicks.push({ label: result.pickLabel, fromTeam: move.from, toTeam: move.to });
    }
  }

  const nextUserTeam = findTeamInLeague(nextLeague, userTeamName);
  const nextCpuTeam = findTeamInLeague(nextLeague, cpuTeamName);
  refreshTeamFinancialSnapshot(nextUserTeam, nextLeague);
  refreshTeamFinancialSnapshot(nextCpuTeam, nextLeague);

  const tradeRecord = {
    id: `trade_${Date.now()}`,
    completedAt: new Date().toISOString(),
    seasonYear: getCurrentSeasonYear(nextLeague),
    userTeamName,
    cpuTeamName,
    userSent: summarizeTradeItems(userItems),
    cpuSent: summarizeTradeItems(cpuItems),
    movedPlayers,
    movedPicks,
    cpuDecision: evaluation?.decision || "accept",
    cpuScore: Number(evaluation?.score || 0),
  };

  nextLeague.tradeHistory = [...(Array.isArray(nextLeague.tradeHistory) ? nextLeague.tradeHistory : []), tradeRecord];
  nextLeague.lastTrade = tradeRecord;

  clearSavedGameplanForTeam(userTeamName);
  clearSavedGameplanForTeam(cpuTeamName);

  return { ok: true, leagueData: nextLeague, tradeRecord };
}

function decisionTone(decision) {
  if (decision === "accept") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  return "border-red-400/30 bg-red-500/10 text-red-100";
}

function RatingRing({ overall, potential, size = 88, style = {}, textTuning = {} }) {
  const safeOverall = Number(overall || 0);
  const fillPercent = Math.min(Math.max(safeOverall, 0) / 99, 1);
  const radius = 34;
  const strokeWidth = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - fillPercent);
  const ovrLabel = textTuning.ovrLabel || {};
  const ovrNumber = textTuning.ovrNumber || {};
  const potLine = textTuning.potLine || {};

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 88 88">
        <defs>
          <linearGradient id="tradeOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFA500" />
            <stop offset="100%" stopColor="#FFD54F" />
          </linearGradient>
        </defs>
        <circle
          cx="44"
          cy="44"
          r={radius}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={strokeWidth}
          fill="rgba(0,0,0,0.22)"
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          stroke="url(#tradeOvrGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <div
          className="font-black uppercase tracking-wide text-neutral-300"
          style={{
            fontSize: ovrLabel.size ?? 8,
            transform: `translate(${ovrLabel.x || 0}px, ${ovrLabel.y || 0}px)`,
          }}
        >
          OVR
        </div>
        <div
          className="mt-0.5 font-black text-orange-400"
          style={{
            fontSize: ovrNumber.size ?? 25,
            transform: `translate(${ovrNumber.x || 0}px, ${ovrNumber.y || 0}px)`,
          }}
        >
          {overall ?? "-"}
        </div>
        <div
          className="mt-0.5 font-black uppercase text-neutral-400"
          style={{
            fontSize: potLine.size ?? 7,
            transform: `translate(${potLine.x || 0}px, ${potLine.y || 0}px)`,
          }}
        >
          POT <span className="text-orange-300">{potential ?? "-"}</span>
        </div>
      </div>
    </div>
  );
}

function getTradeItemLogoTuningForTeam(team) {
  const teamName = team?.name || team?.teamName || "";
  let override = null;

  if (sameTeamName(teamName, "New Orleans Pelicans")) {
    override = TRADE_ITEM_BACKGROUND_LOGO_TEAM_OVERRIDES.pelicans;
  }

  if (sameTeamName(teamName, "Portland Trail Blazers")) {
    override = TRADE_ITEM_BACKGROUND_LOGO_TEAM_OVERRIDES.trailBlazers;
  }

  return {
    ...TRADE_ITEM_BACKGROUND_LOGO_TUNING,
    ...(override || {}),
  };
}

function TeamLogoWatermark({ team }) {
  const logo = teamLogoOf(team);
  const t = getTradeItemLogoTuningForTeam(team);

  if (!t.enabled || !logo) return null;

  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 z-0 object-contain select-none"
      style={{
        width: t.size,
        height: t.size,
        opacity: t.opacity,
        mixBlendMode: t.blendMode || "normal",
        filter: `brightness(${t.brightness || 1}) contrast(${t.contrast || 1}) saturate(${t.saturate || 1}) blur(${t.blur || 0}px)`,
        transform: `translate(-50%, -50%) translate(${t.x || 0}px, ${t.y || 0}px) rotate(${t.rotate || 0}deg)`,
      }}
    />
  );
}

function TradeItemCard({ item, team, leagueData, onRemove }) {
  if (!item) return null;

  if (item.type === "player") {
    const player = item.player || {};
    const playerName = playerNameOf(player);
    const yearsRemaining = getContractYearsRemaining(player, leagueData);
    const t = TRADE_PLAYER_CARD_TUNING;
    const nameFontSize = getTradeCardNameFontSize(playerName, t.name.size);

    return (
      <div
        className="relative isolate w-full max-w-full overflow-hidden rounded-2xl border border-white/15 bg-black pr-10"
        style={{ height: t.cardHeight, minWidth: 0, boxSizing: "border-box" }}
      >
        <TeamLogoWatermark team={team} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="absolute right-2 top-2 z-20 rounded-full bg-black/70 px-2 py-0.5 text-xs font-black text-neutral-300 hover:bg-red-600 hover:text-white"
        >
          ✕
        </button>

        <div className="relative z-10 flex h-full items-center gap-4">
          <div
            className="relative flex h-full shrink-0 items-end justify-center overflow-hidden rounded-l-2xl"
            style={{ width: t.face.boxWidth }}
          >
            {player?.headshot ? (
              <img
                src={player.headshot}
                alt={playerName}
                className="w-auto object-contain"
                style={{
                  height: t.face.imageHeight,
                  transform: `translate(${t.face.x}px, ${t.face.y}px)`,
                }}
              />
            ) : (
              <div className="h-full w-full" />
            )}
          </div>

          <RatingRing
            overall={player.overall}
            potential={player.potential}
            size={t.ring.size}
            style={{ transform: `translate(${t.ring.x}px, ${t.ring.y}px)` }}
            textTuning={t.ringText}
          />

          <div
            className="min-w-0 flex-1 overflow-hidden pr-7"
            style={{
              width: 0,
              maxWidth: "100%",
              transform: `translate(${t.textBlock.x}px, ${t.textBlock.y}px)`,
            }}
          >
            <div
              className="font-black leading-tight text-white"
              title={playerName}
              style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: nameFontSize,
                transform: `translate(${t.name.x}px, ${t.name.y}px)`,
              }}
            >
              {playerName}
            </div>
            <div
              className="mt-1 font-black uppercase tracking-[0.18em] text-white"
              style={{
                fontSize: t.positionAge.size,
                transform: `translate(${t.positionAge.x}px, ${t.positionAge.y}px)`,
              }}
            >
              {player.pos || "-"}{player.secondaryPos ? ` / ${player.secondaryPos}` : ""}
              <span className="mx-2 text-white">•</span>
              Age {player.age ?? "-"}
            </div>
            <div
              className="mt-1 font-black uppercase tracking-[0.12em] text-white"
              style={{
                fontSize: t.contract.size,
                transform: `translate(${t.contract.x}px, ${t.contract.y}px)`,
              }}
            >
              Contract: <span className="text-white">{formatMoney(getPlayerSalary(player, leagueData))}</span>
              <span className="mx-2 text-white">•</span>
              <span className="text-white">
                {yearsRemaining || "—"} YR{yearsRemaining === 1 ? "" : "S"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pickProtection = item.protection || item.pick?.protection || "Unprotected";
  const pickLabel = item.displayLabel || `${pickProtection} ${formatPick(item.pick)}`;
  const pickOriginalTeam = getPickOriginalTeamLogoTeam(leagueData, item.pick, team);

  return (
    <div className="relative isolate h-full overflow-hidden rounded-2xl border border-white/15 bg-black p-4">
      <TeamLogoWatermark team={pickOriginalTeam} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        className="absolute right-2 top-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-xs font-black text-neutral-300 hover:bg-red-600 hover:text-white"
      >
        ✕
      </button>
      <div className="relative z-10 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Draft Pick</div>
      <div className="relative z-10 mt-2 pr-8 text-lg font-black text-white">
        {pickLabel}
      </div>
    </div>
  );
}

function EmptySlot({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[126px] w-full rounded-2xl border border-white/15 bg-black p-6 text-left transition hover:border-orange-400/45"
    >
      <div className="text-xl font-black text-white">{label}</div>
      <div className="mt-2 text-sm font-semibold text-neutral-500">Player or Pick</div>
    </button>
  );
}

function AddAssetButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[126px] w-full rounded-2xl border border-white/15 bg-black p-6 text-left transition hover:border-orange-400/45 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <div className="text-xl font-black text-white">Add Trade Item</div>
      <div className="mt-2 text-sm font-semibold text-neutral-500">Player or Pick</div>
    </button>
  );
}


function countTradePlayers(items = []) {
  return (items || []).filter((item) => item?.type === "player" && item.player).length;
}

function getStandardRosterCount(team) {
  return Array.isArray(team?.players) ? team.players.length : 0;
}

function TradeFinancialRow({ label, value, tuning }) {
  const labelT = tuning?.label || {};
  const valueT = tuning?.value || {};

  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-5"
      style={{ paddingTop: tuning?.rows?.gap ?? 2, paddingBottom: tuning?.rows?.gap ?? 2 }}
    >
      <div
        className="font-black uppercase text-white"
        style={{
          fontSize: labelT.size ?? 14,
          letterSpacing: labelT.letterSpacing ?? "0.08em",
          transform: `translate(${labelT.x || 0}px, ${labelT.y || 0}px)`,
        }}
      >
        {label}
      </div>
      <div
        className="text-right font-black text-white"
        style={{
          fontSize: valueT.size ?? 14,
          transform: `translate(${valueT.x || 0}px, ${valueT.y || 0}px)`,
        }}
      >
        {value}
      </div>
    </div>
  );
}


function buildHardCapIssueDetails({ team, cap, outgoingSalary = 0, incomingSalary = 0, netSalary = 0, playerCount = 0, financialCheck = null }) {
  if (financialCheck) {
    return {
      title: financialCheck.title,
      message: financialCheck.message,
      rows: [
        ...(financialCheck.rows || []),
        { label: "Projected players", value: playerCount },
      ],
    };
  }

  const teamName = team?.name || team?.teamName || "This team";
  const projectedPayroll = Number(cap?.payroll || 0);
  const basePayroll = Number(cap?.basePayroll || 0);

  return {
    title: `${teamName} Trade Salary Details`,
    message: `${teamName}'s projected payroll after this trade is ${formatMoney(projectedPayroll)}.`,
    rows: [
      { label: "Current payroll", value: formatMoney(basePayroll) },
      { label: "Outgoing salary", value: formatMoney(outgoingSalary) },
      { label: "Incoming salary", value: formatMoney(incomingSalary) },
      { label: "Net salary change", value: formatMoney(netSalary) },
      { label: "Projected payroll", value: formatMoney(projectedPayroll) },
      { label: "Salary cap", value: formatMoney(cap?.salaryCap) },
      { label: "First apron", value: formatMoney(cap?.firstApron) },
      { label: "Second apron", value: formatMoney(cap?.secondApron) },
      { label: "Hard cap", value: formatMoney(cap?.hardCap) },
      { label: "Projected players", value: playerCount },
    ],
  };
}

function TradeFinancialFooter({ team, cap, netSalary, playerCount, hardCapDetails = null, onHardCapDetails = null, financialCheck = null }) {
  const isFinancialOk = financialCheck ? Boolean(financialCheck.ok) : Number(cap?.hardCapRoom || 0) >= 0;
  const t = TRADE_FINANCIAL_FOOTER_TUNING;

  return (
    <div
      className="border-t border-white/20 bg-black"
      style={{
        paddingLeft: t.footer.paddingX,
        paddingRight: t.footer.paddingX,
        paddingTop: t.footer.paddingY,
        paddingBottom: t.footer.paddingY,
        transform: `translate(${t.footer.x || 0}px, ${t.footer.y || 0}px)`,
      }}
    >
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: `${t.footer.logoColumnWidth}px 1fr`,
          columnGap: t.footer.gap,
        }}
      >
        <div className="flex items-center justify-center">
          {teamLogoOf(team) ? (
            <img
              src={teamLogoOf(team)}
              alt={team?.name || "Team"}
              className="object-contain"
              style={{
                width: t.logo.size,
                height: t.logo.size,
                transform: `translate(${t.logo.x || 0}px, ${t.logo.y || 0}px)`,
              }}
            />
          ) : (
            <div
              className="border border-white/15 bg-black"
              style={{
                width: t.logo.size,
                height: t.logo.size,
                transform: `translate(${t.logo.x || 0}px, ${t.logo.y || 0}px)`,
              }}
            />
          )}
        </div>

        <div
          className="min-w-0"
          style={{
            width: t.rowsBlock.width,
            transform: `translate(${t.rowsBlock.x || 0}px, ${t.rowsBlock.y || 0}px)`,
          }}
        >
          <div>
            <TradeFinancialRow label="Salary Cap Room" value={formatMoney(cap.capRoom)} tuning={t} />
            <TradeFinancialRow label="Hard Cap Room" value={formatMoney(cap.hardCapRoom)} tuning={t} />
            <TradeFinancialRow label="Net Salary" value={formatMoney(netSalary)} tuning={t} />
            <TradeFinancialRow label="Players" value={playerCount} tuning={t} />
          </div>

          <div
            className={`flex items-center justify-center font-black tracking-wide ${
              isFinancialOk ? "bg-emerald-500 text-white" : "bg-red-600 text-white"
            }`}
            style={{
              height: t.statusBar.height,
              marginTop: t.statusBar.marginTop,
              width: t.statusBar.width,
              fontSize: t.statusBar.fontSize,
              transform: `translate(${t.statusBar.x || 0}px, ${t.statusBar.y || 0}px)`,
            }}
          >
            <span
              className="inline-flex items-center justify-center gap-2"
              style={{ transform: `translate(${t.statusBar.textX || 0}px, ${t.statusBar.textY || 0}px)` }}
            >
              {isFinancialOk ? (
                "Valid Trade"
              ) : (
                <>
                  {financialCheck?.statusLabel || "Trade Salary Issue"}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onHardCapDetails?.(hardCapDetails);
                    }}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/80 bg-transparent text-[10px] font-black leading-none text-white transition hover:bg-white hover:text-red-700"
                    title="Why is this trade salary issue happening?"
                    aria-label="View trade salary issue details"
                  >
                    ?
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidePanel({ side, team, items, leagueData, incomingSalary = 0, incomingItems = [], onAdd, onRemove, onHardCapDetails }) {
  const salaryTotal = sideSalary(items, leagueData);
  const cap = getTeamCapInfo(team, leagueData, salaryTotal, incomingSalary);
  const financialCheck = evaluateTradeFinancialLegality({
    team,
    leagueData,
    outgoingSalary: salaryTotal,
    incomingSalary,
  });
  const hasItems = Array.isArray(items) && items.length > 0;
  const canAddMore = (items || []).length < MAX_SIDE_ITEMS;
  const netSalary = Number(incomingSalary || 0) - Number(salaryTotal || 0);
  const playerCount = Math.max(
    0,
    getStandardRosterCount(team) - countTradePlayers(items) + countTradePlayers(incomingItems)
  );
  const hardCapDetails = buildHardCapIssueDetails({
    team,
    cap,
    outgoingSalary: salaryTotal,
    incomingSalary,
    netSalary,
    playerCount,
    financialCheck,
  });

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/15 bg-black">
      <div className="border-b border-white/20 bg-black px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {teamLogoOf(team) ? (
              <img src={teamLogoOf(team)} alt={team?.name} className="h-12 w-12 shrink-0 object-contain" />
            ) : (
              <div className="h-12 w-12 rounded-xl bg-white/5" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">
                {side === "user" ? "Your Team" : "CPU Team"}
              </div>
              <div className="truncate text-xl font-black text-white">{team?.name || "Select Team"}</div>
            </div>
          </div>
          <div className="rounded-xl border border-orange-400/25 bg-black px-3 py-2 text-right">
            <div className="text-[10px] font-black uppercase text-orange-200">Incoming</div>
            <div className="text-sm font-black text-white">{formatMoney(incomingSalary)}</div>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 p-4">
        {hasItems ? (
          sortTradeItemsForDisplay(items).map((item) => {
            const key = itemKey(item);
            return (
              <div key={`${side}-${key}`} className="w-full min-w-0 overflow-hidden" style={{ height: TRADE_PLAYER_CARD_TUNING.cardHeight }}>
                <TradeItemCard
                  item={item}
                  team={team}
                  leagueData={leagueData}
                  onRemove={() => onRemove(side, key)}
                />
              </div>
            );
          })
        ) : (
          <div className="w-full min-w-0 overflow-hidden" style={{ height: TRADE_PLAYER_CARD_TUNING.cardHeight }}>
            <EmptySlot label="Add Trade Item" onClick={() => onAdd(side, 0)} />
          </div>
        )}

        {hasItems && canAddMore && (
          <AddAssetButton onClick={() => onAdd(side, items.length)} />
        )}

        {hasItems && !canAddMore && (
          <div className="rounded-2xl border border-white/15 bg-black px-5 py-4 text-xs font-bold text-neutral-500">
            Maximum trade assets added for this side.
          </div>
        )}
      </div>

      <TradeFinancialFooter
        team={team}
        cap={cap}
        netSalary={netSalary}
        playerCount={playerCount}
        hardCapDetails={hardCapDetails}
        onHardCapDetails={onHardCapDetails}
        financialCheck={financialCheck}
      />
    </div>
  );
}

export default function ProposeTrade() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData, selectedTeam, setLeagueData } = useGame();
  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const userTeamName = selectedTeam?.name || "";
  const cpuTeamOptions = useMemo(
    () =>
      teams
        .filter((team) => team?.name && team.name !== userTeamName)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [teams, userTeamName]
  );
  const firstCpu = cpuTeamOptions[0]?.name || "";

  const [builder, setBuilder] = useState(() => {
    const saved = safeReadBuilder();
    return saved || makeEmptyBuilder(userTeamName, firstCpu);
  });
  const [slotMenu, setSlotMenu] = useState(null);
  const [notice, setNotice] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deadlineStatus, setDeadlineStatus] = useState(() => readTradeDeadlineStatus());
  const [hardCapDetailModal, setHardCapDetailModal] = useState(null);

  useEffect(() => {
    const syncDeadlineStatus = () => setDeadlineStatus(readTradeDeadlineStatus());
    syncDeadlineStatus();

    window.addEventListener("storage", syncDeadlineStatus);
    const intervalId = window.setInterval(syncDeadlineStatus, 1500);

    return () => {
      window.removeEventListener("storage", syncDeadlineStatus);
      window.clearInterval(intervalId);
    };
  }, []);

  const tradeDeadlineLocked = isTradeDeadlineLocked(deadlineStatus);
  const tradeDeadlineMessage = tradeDeadlineLocked
    ? "The trade deadline has passed. New trade offers are locked until the offseason."
    : "";

  const cpuTeamName = builder.cpuTeamName || firstCpu;
  const userTeam = teams.find((t) => t?.name === userTeamName) || selectedTeam;
  const cpuTeam = teams.find((t) => t?.name === cpuTeamName) || cpuTeamOptions[0] || null;
  const userItems = builder.userItems || [];
  const cpuItems = builder.cpuItems || [];
  const cameFromTradeFinder = Boolean(
    builder?.returnToTradeFinder ||
      builder?.source === "tradeFinder" ||
      location?.state?.fromTradeFinder
  );
  const topBackLabel = cameFromTradeFinder ? "← Trade Finder Results" : "← Trade Center";
  const topBackPath = cameFromTradeFinder ? "/trade-finder" : "/trades";

  useEffect(() => {
    if (!userTeamName) return;

    if (builder?.userTeamName && builder.userTeamName !== userTeamName) {
      setEvaluation(null);
      setSlotMenu(null);
      setHardCapDetailModal(null);
      setNotice("");
    }

    setBuilder((prev) => {
      const saved = prev || makeEmptyBuilder(userTeamName, firstCpu);
      const userTeamChanged = Boolean(saved?.userTeamName && saved.userTeamName !== userTeamName);
      const cpuTeamStillValid = Boolean(
        saved?.cpuTeamName &&
          saved.cpuTeamName !== userTeamName &&
          cpuTeamOptions.some((team) => team?.name === saved.cpuTeamName)
      );

      const next = userTeamChanged
        ? makeEmptyBuilder(userTeamName, firstCpu)
        : {
            ...saved,
            userTeamName,
            cpuTeamName: cpuTeamStillValid ? saved.cpuTeamName : firstCpu,
          };

      saveBuilder(next);
      return next;
    });
  }, [userTeamName, firstCpu, cpuTeamOptions]);

  useEffect(() => {
    saveBuilder(builder);
  }, [builder]);

  const updateBuilder = (updater) => {
    setEvaluation(null);
    setBuilder((prev) => {
      const next = updater(prev || makeEmptyBuilder(userTeamName, firstCpu));
      saveBuilder(next);
      return next;
    });
  };

  const handleCpuTeamChange = (name) => {
    if (tradeDeadlineLocked) {
      setNotice(tradeDeadlineMessage);
      return;
    }

    const swapCount = [...(builder.userItems || []), ...(builder.cpuItems || [])].filter(isSwapTradeItem).length;

    updateBuilder((prev) => {
      const sameCpuTeam = prev.cpuTeamName === name;
      return {
        ...prev,
        cpuTeamName: name,
        // Normal players, unprotected picks, and protected picks can stay when
        // changing the negotiation partner. Pick swaps are different: they are
        // tied to the exact two teams in the swap pair, so they must be rebuilt.
        userItems: sameCpuTeam ? prev.userItems : stripSwapTradeItems(prev.userItems || []),
        cpuItems: sameCpuTeam ? prev.cpuItems : [],
        updatedAt: Date.now(),
      };
    });

    if (swapCount > 0 && builder.cpuTeamName !== name) {
      setNotice("CPU team changed; old pick swaps were removed because swaps are tied to the exact two teams.");
    }
  };

  const removeItem = (side, itemIdentity) => {
    updateBuilder((prev) => {
      const items = [...getSideItems(prev, side)];
      const identityIsIndex = typeof itemIdentity === "number";
      const removed = identityIsIndex
        ? items[itemIdentity]
        : items.find((item) => itemKey(item) === itemIdentity);
      const nextItems = identityIsIndex
        ? items.filter((_, index) => index !== itemIdentity)
        : items.filter((item) => itemKey(item) !== itemIdentity);

      const swapId = removed?.tradeRule?.swapId || removed?.pick?.tradeRule?.swapId || "";
      let next = setSideItems(prev, side, nextItems);
      if (swapId) {
        const otherSide = side === "user" ? "cpu" : "user";
        const otherItems = getSideItems(next, otherSide).filter(
          (item) => (item?.tradeRule?.swapId || item?.pick?.tradeRule?.swapId || "") !== swapId
        );
        next = setSideItems(next, otherSide, otherItems);
      }
      return next;
    });
  };

  const openAddMenu = (side, slotIndex) => {
    if (tradeDeadlineLocked) {
      setNotice(tradeDeadlineMessage);
      return;
    }

    setSlotMenu({ side, slotIndex });
  };

  const goSelectPlayer = () => {
    if (tradeDeadlineLocked) {
      setSlotMenu(null);
      setNotice(tradeDeadlineMessage);
      return;
    }

    if (!slotMenu) return;
    const teamName = slotMenu.side === "user" ? userTeamName : cpuTeamName;
    saveBuilder(builder);
    navigate("/trade-player-select", {
      state: {
        tradeSide: slotMenu.side,
        tradeTeamName: teamName,
        returnTo: "/propose-trade",
      },
    });
  };

  const goSelectPick = () => {
    if (tradeDeadlineLocked) {
      setSlotMenu(null);
      setNotice(tradeDeadlineMessage);
      return;
    }

    if (!slotMenu) return;
    const teamName = slotMenu.side === "user" ? userTeamName : cpuTeamName;
    saveBuilder(builder);
    navigate("/trade-pick-select", {
      state: {
        tradeSide: slotMenu.side,
        tradeTeamName: teamName,
        returnTo: "/propose-trade",
      },
    });
  };

  const resetProposalSession = (nextCpuTeamName = firstCpu, nextNotice = "") => {
    const next = makeEmptyBuilder(userTeamName, nextCpuTeamName || firstCpu);
    setBuilder(next);
    saveBuilder(next);
    setEvaluation(null);
    setSlotMenu(null);
    setHardCapDetailModal(null);
    if (nextNotice) setNotice(nextNotice);
  };

  const clearProposal = () => {
    const preservedCpuTeamName = cpuTeamName && cpuTeamName !== userTeamName ? cpuTeamName : firstCpu;
    resetProposalSession(preservedCpuTeamName, "Proposal cleared.");
  };

  const leaveTradeBuilder = () => {
    resetProposalSession(firstCpu, "");
    navigate(topBackPath);
  };

  const evaluateWithCpu = async () => {
    if (tradeDeadlineLocked) {
      setEvaluation(null);
      setNotice(tradeDeadlineMessage);
      return;
    }

    const hasAnyTradeItem = userItems.length > 0 || cpuItems.length > 0;

    if (!hasAnyTradeItem) {
      setEvaluation(null);
      setNotice("Add at least one trade item before evaluation.");
      return;
    }

    const proposal = buildTradeProposalPayload({
      userTeamName,
      cpuTeamName,
      userTeam,
      cpuTeam,
      userItems,
      cpuItems,
      leagueData,
    });

    setIsEvaluating(true);
    setEvaluation(null);
    setNotice("CPU front office is reviewing the proposal...");

    try {
      const result = evaluateTradeTeamImpact({
        leagueData,
        userTeam,
        cpuTeam,
        userTeamName,
        cpuTeamName,
        userItems,
        cpuItems,
      });
      debugProposeTradeEvaluation({ result, userTeamName, cpuTeamName, userItems, cpuItems, leagueData });
      setEvaluation(result);
      setNotice(result?.message || "CPU evaluation complete.");
    } catch (error) {
      setEvaluation(null);
      setNotice(`CPU evaluation failed: ${error?.message || String(error || "Unknown error")}`);
    } finally {
      setIsEvaluating(false);
    }
  };


  const submitAcceptedTrade = () => {
    if (tradeDeadlineLocked) {
      setNotice(tradeDeadlineMessage);
      return;
    }

    if (isSubmitting) return;

    const result = executeAcceptedTradeOnLeagueShared({
      leagueData,
      userTeamName,
      cpuTeamName,
      userItems,
      cpuItems,
      evaluation,
    });

    if (!result.ok) {
      setNotice(result.reason || "Trade could not be submitted.");
      return;
    }

    setIsSubmitting(true);

    try {
      setLeagueData(result.leagueData);
      saveLeagueData(result.leagueData).catch((err) => {
        console.warn("[ProposeTrade] IndexedDB league save failed", err);
      });
      try {
        window.__leagueData = result.leagueData;
        window.leagueData = result.leagueData;
        window.__basketballManagerLeagueData = result.leagueData;
      } catch {}

      const nextBuilder = makeEmptyBuilder(userTeamName, cpuTeamName || firstCpu);
      setBuilder(nextBuilder);
      saveBuilder(nextBuilder);
      setEvaluation(null);
      setNotice(`Trade completed: ${userTeamName} and ${cpuTeamName} have finalized the deal.`);
    } catch (error) {
      setNotice(`Trade save failed: ${error?.message || String(error || "Unknown error")}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!selectedTeam || !leagueData) {
    return (
      <PageFade>
        <div className="min-h-screen bmCourtPage text-white flex flex-col items-center justify-center px-4">
          <p className="mb-4 text-lg font-semibold">No league/team loaded.</p>
          <button onClick={() => navigate("/team-hub")} className="rounded-xl bg-orange-600 px-6 py-3 font-bold">
            Team Hub
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="min-h-screen bmCourtPage text-white px-4 py-8">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <button
              onClick={leaveTradeBuilder}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 hover:bg-white/10 hover:text-white"
            >
              {topBackLabel}
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">
                Propose Trades
              </div>
              <h1 className="mt-1 text-4xl font-black text-orange-500">Trade Builder</h1>
            </div>

            <button
              onClick={clearProposal}
              className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/20"
            >
              Clear
            </button>
          </div>

          <div className="mb-5 grid gap-4 rounded-2xl border border-white/10 bg-black px-5 py-4 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
            <div className="text-sm font-semibold text-neutral-300">
              Current Team: <span className="font-black text-white">{userTeamName}</span>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row xl:justify-center">
              <button
                onClick={evaluateWithCpu}
                disabled={isEvaluating || tradeDeadlineLocked}
                className="rounded-2xl bg-orange-600 px-8 py-3 text-sm font-black text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isEvaluating ? "Evaluating..." : "Evaluate Trade"}
              </button>
              <button
                onClick={submitAcceptedTrade}
                disabled={isSubmitting || tradeDeadlineLocked}
                className="rounded-2xl border border-white/15 bg-black px-8 py-3 text-sm font-black text-neutral-200 transition hover:border-orange-400/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Submitting..." : "Submit Proposal"}
              </button>
            </div>

            <label className="flex items-center gap-3 text-sm font-bold text-neutral-300 xl:justify-end">
              CPU Team
              <select
                value={cpuTeamName}
                onChange={(e) => handleCpuTeamChange(e.target.value)}
                disabled={tradeDeadlineLocked}
                className="rounded-xl border border-white/10 bg-black px-3 py-2 font-black text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cpuTeamOptions.map((team) => (
                  <option key={team.name} value={team.name}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {tradeDeadlineLocked && (
            <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm font-black text-red-100">
              Trade deadline passed. New trade offers are locked until the offseason.
            </div>
          )}

          {(notice || evaluation) && (
            <div className="mb-5 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
              {notice && (
                <div className="relative rounded-2xl border border-orange-400/25 bg-orange-500/10 p-3 pr-10 text-xs font-bold text-orange-100">
                  <button
                    type="button"
                    onClick={() => setNotice("")}
                    className="absolute right-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-black text-orange-100 transition hover:bg-red-600 hover:text-white"
                    title="Dismiss message"
                  >
                    ✕
                  </button>
                  {notice}
                </div>
              )}

              {evaluation && (
                <div className={`relative rounded-2xl border p-3 pr-10 text-left text-xs font-bold ${decisionTone(evaluation.decision)}`}>
                  <button
                    type="button"
                    onClick={() => setEvaluation(null)}
                    className="absolute right-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-black text-white/80 transition hover:bg-red-600 hover:text-white"
                    title="Dismiss CPU decision"
                  >
                    ✕
                  </button>
                  <div className="flex items-center justify-between gap-3 pr-8">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">CPU Decision</span>
                    <span className="rounded-full bg-black/25 px-2 py-1 text-[10px] font-black uppercase">
                      Score {Number(evaluation.score || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 text-lg font-black uppercase">
                    {evaluation.decision || "reject"}
                  </div>

                  {Array.isArray(evaluation.reasons) && evaluation.reasons.length > 0 && (
                    <div className="mt-3 space-y-1 opacity-90">
                      {evaluation.reasons.slice(0, 8).map((reason, index) => (
                        <div key={`reason-${index}`}>• {reason}</div>
                      ))}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <SidePanel
              side="user"
              team={userTeam}
              items={userItems}
              leagueData={leagueData}
              incomingSalary={sideSalary(cpuItems, leagueData)}
              incomingItems={cpuItems}
              onAdd={openAddMenu}
              onRemove={removeItem}
              onHardCapDetails={setHardCapDetailModal}
            />

            <SidePanel
              side="cpu"
              team={cpuTeam}
              items={cpuItems}
              leagueData={leagueData}
              incomingSalary={sideSalary(userItems, leagueData)}
              incomingItems={userItems}
              onAdd={openAddMenu}
              onRemove={removeItem}
              onHardCapDetails={setHardCapDetailModal}
            />
          </div>

        </div>

        {hardCapDetailModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setHardCapDetailModal(null);
            }}
          >
            <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-red-400/30 bg-neutral-950 shadow-2xl">
              <div className="border-b border-red-400/20 bg-gradient-to-r from-red-600/25 to-neutral-900 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-red-200">Hard Cap Details</div>
                    <div className="mt-1 text-2xl font-black text-white">
                      {hardCapDetailModal.title || "Trade Salary Issue"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHardCapDetailModal(null)}
                    className="rounded-full bg-black/40 px-3 py-1 text-sm font-black text-white/80 transition hover:bg-red-600 hover:text-white"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-100">
                  {hardCapDetailModal.message || "This trade does not satisfy the trade salary rules."}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black p-4">
                  {(hardCapDetailModal.rows || []).map((row, index) => (
                    <div
                      key={`${row.label}-${index}`}
                      className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 py-2 text-sm last:border-b-0"
                    >
                      <div className="font-black uppercase tracking-[0.12em] text-neutral-400">{row.label}</div>
                      <div className="font-black text-white">{row.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 text-xs font-semibold leading-5 text-neutral-400">
                  Fix it by sending out more salary, taking back less salary, or choosing a different trade package.
                </div>
              </div>
            </div>
          </div>
        )}

        {slotMenu && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSlotMenu(null);
            }}
          >
            <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-orange-600/20 to-neutral-900 px-6 py-5">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Add Trade Item</div>
                <div className="mt-1 text-2xl font-black text-white">
                  {slotMenu.side === "user" ? userTeamName : cpuTeamName}
                </div>
              </div>
              <div className="grid gap-3 p-5">
                <button
                  onClick={goSelectPlayer}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5 text-left transition hover:border-orange-400/40 hover:bg-orange-500/10"
                >
                  <div className="text-lg font-black text-white">Player</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-500">Open trade player selector for this team.</div>
                </button>
                <button
                  onClick={goSelectPick}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5 text-left transition hover:border-orange-400/40 hover:bg-orange-500/10"
                >
                  <div className="text-lg font-black text-white">Pick</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-500">Open pick selector and choose valid pick rules.</div>
                </button>
                <button
                  onClick={() => setSlotMenu(null)}
                  className="rounded-2xl border border-white/10 bg-black px-5 py-3 text-sm font-black text-neutral-400 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageFade>
  );
}
