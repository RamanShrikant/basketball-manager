import { getLeagueFinancialRules } from "./leagueFinancials.js";
import { evaluateTradeTeamImpact } from "./tradeTeamImpact.js";
import {
  buildTradeMachineSwapAssets,
  getTradeablePickOwnedRange,
  makeTradeGeneratedDraftPickId,
  normalizeDraftPickAsset,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  validateCustomPickProtection,
} from "./draftPicks.js";

// Shared trade execution helpers.
// ProposeTrade and CPU-to-CPU trades can use the same movement, salary, roster,
// protected-pick, swap, and draft-order ownership logic.

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
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

function getSideItems(builder, side) {
  return side === "user" ? builder.userItems || [] : builder.cpuItems || [];
}

function setSideItems(builder, side, nextItems) {
  if (side === "user") return { ...builder, userItems: nextItems, updatedAt: Date.now() };
  return { ...builder, cpuItems: nextItems, updatedAt: Date.now() };
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

  const existingIds = new Set(rows.map((row) => String(row.id || "")));
  for (const asset of swapAssets) {
    if (!existingIds.has(String(asset.id || ""))) rows.push(asset);
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


function countTradePlayers(items = []) {
  return (items || []).filter((item) => item?.type === "player" && item.player).length;
}

function getStandardRosterCount(team) {
  return Array.isArray(team?.players) ? team.players.length : 0;
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

  if (!userItems.length || !cpuItems.length) {
    return { ok: false, reason: "Add at least one asset from each side before submitting." };
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


function getTradeTimingSnapshot(leagueData = {}) {
  const date =
    leagueData?.currentDate ||
    leagueData?.leagueDate ||
    leagueData?.today ||
    leagueData?.date ||
    leagueData?.calendar?.currentDate ||
    leagueData?.calendar?.date ||
    leagueData?.scheduleState?.currentDate ||
    leagueData?.scheduleState?.date ||
    leagueData?.seasonState?.currentDate ||
    leagueData?.seasonState?.date ||
    "";

  const dayRaw =
    leagueData?.currentDay ??
    leagueData?.day ??
    leagueData?.dayIndex ??
    leagueData?.calendar?.currentDay ??
    leagueData?.calendar?.day ??
    leagueData?.calendar?.dayIndex ??
    leagueData?.scheduleState?.currentDay ??
    leagueData?.scheduleState?.day ??
    leagueData?.scheduleState?.dayIndex ??
    leagueData?.seasonState?.currentDay ??
    leagueData?.seasonState?.day ??
    leagueData?.seasonState?.dayIndex ??
    null;

  const dayNumber = Number(dayRaw);
  const day = Number.isFinite(dayNumber) && dayNumber > 0 ? dayNumber : null;

  return {
    date: typeof date === "string" ? date : "",
    currentDate: typeof date === "string" ? date : "",
    day,
    dayIndex: day,
  };
}

function normalizeTradeReasonText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstEvaluationReason(evaluation = {}, fallback = "") {
  const message = normalizeTradeReasonText(evaluation?.message);
  if (message) return message;

  const reason = Array.isArray(evaluation?.reasons)
    ? evaluation.reasons.map(normalizeTradeReasonText).find(Boolean)
    : "";
  if (reason) return reason;

  return normalizeTradeReasonText(fallback);
}

function summarizeAssetsForReason(items = []) {
  const labels = (items || [])
    .map((item) => {
      if (item?.type === "player") return playerNameOf(item.player);
      if (item?.type === "pick") return item.displayLabel || `${formatPick(item.pick)} (${item.protection || item.pick?.protection || "Unprotected"})`;
      return "";
    })
    .filter(Boolean);

  if (!labels.length) return "salary and roster pieces";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels.length - 2} more assets`;
}

function summarizeDetailedTradeItems(items = [], fromTeamName = "", leagueData = {}) {
  return (items || [])
    .map((item) => {
      if (item?.type === "player" && item.player) {
        const player = item.player || {};
        return {
          type: "player",
          label: playerNameOf(player),
          playerName: playerNameOf(player),
          playerId: player?.id ?? player?.playerId ?? null,
          teamName: fromTeamName,
          pos: player?.pos || player?.position || "",
          age: Number.isFinite(Number(player?.age)) ? Number(player.age) : null,
          overall: Number.isFinite(Number(player?.overall ?? player?.ovr)) ? Number(player?.overall ?? player?.ovr) : null,
          potential: Number.isFinite(Number(player?.potential ?? player?.pot)) ? Number(player?.potential ?? player?.pot) : null,
          salary: getPlayerSalary(player, leagueData),
        };
      }

      if (item?.type === "pick" && item.pick) {
        const pick = item.pick || {};
        const protection = item.protection || pick.displayProtection || pick.protections || pick.protection || "Unprotected";
        return {
          type: "pick",
          label: item.displayLabel || `${formatPick(pick)} (${protection})`,
          displayLabel: item.displayLabel || `${formatPick(pick)} (${protection})`,
          pickId: pick?.id || pick?.pickId || null,
          teamName: fromTeamName,
          year: pick?.year || pick?.season || pick?.seasonYear || null,
          round: pick?.round || pick?.rnd || null,
          originalTeam: pick?.originalTeam || pick?.originalTeamName || pick?.original || pick?.team || "",
          protection,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function buildDefaultTradeReason({ teamName, receivedItems, sentItems, evaluation, cpuSide = false }) {
  const evaluationReason = cpuSide
    ? firstEvaluationReason(evaluation, "the incoming package matched its roster value, salary rules, and team direction")
    : "";

  if (evaluationReason) {
    return `${teamName} accepted because ${evaluationReason.charAt(0).toLowerCase()}${evaluationReason.slice(1)}`;
  }

  return `${teamName} accepted the deal to bring in ${summarizeAssetsForReason(receivedItems)} while sending out ${summarizeAssetsForReason(sentItems)}.`;
}

function buildTradeRecordPackages({ userTeamName, cpuTeamName, userItems, cpuItems, evaluation, leagueData }) {
  const userReceived = summarizeDetailedTradeItems(cpuItems, cpuTeamName, leagueData);
  const userSent = summarizeDetailedTradeItems(userItems, userTeamName, leagueData);
  const cpuReceived = summarizeDetailedTradeItems(userItems, userTeamName, leagueData);
  const cpuSent = summarizeDetailedTradeItems(cpuItems, cpuTeamName, leagueData);

  const userReason = buildDefaultTradeReason({
    teamName: userTeamName,
    receivedItems: cpuItems,
    sentItems: userItems,
    evaluation,
    cpuSide: false,
  });
  const cpuReason = buildDefaultTradeReason({
    teamName: cpuTeamName,
    receivedItems: userItems,
    sentItems: cpuItems,
    evaluation,
    cpuSide: true,
  });

  return {
    userSentAssets: userSent,
    cpuSentAssets: cpuSent,
    teamPackages: [
      {
        teamName: userTeamName,
        received: userReceived,
        sent: userSent,
        reason: userReason,
      },
      {
        teamName: cpuTeamName,
        received: cpuReceived,
        sent: cpuSent,
        reason: cpuReason,
      },
    ],
    reasoning: {
      [userTeamName]: userReason,
      [cpuTeamName]: cpuReason,
    },
  };
}

function reasonFromTeamView(teamName = "", view = {}, fallback = "") {
  const reason = firstEvaluationReason(view, fallback);
  if (!reason) return `${teamName} accepted because the value, salary, and roster fit checked out.`;
  return `${teamName} accepted because ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
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

  const timing = getTradeTimingSnapshot(leagueData);
  const packageDetails = buildTradeRecordPackages({
    userTeamName,
    cpuTeamName,
    userItems,
    cpuItems,
    evaluation,
    leagueData: nextLeague,
  });

  const tradeRecord = {
    id: `trade_${Date.now()}`,
    completedAt: new Date().toISOString(),
    seasonYear: getCurrentSeasonYear(nextLeague),
    date: timing.date,
    currentDate: timing.currentDate,
    day: timing.day,
    dayIndex: timing.dayIndex,
    userTeamName,
    cpuTeamName,
    userSent: summarizeTradeItems(userItems),
    cpuSent: summarizeTradeItems(cpuItems),
    ...packageDetails,
    movedPlayers,
    movedPicks,
    cpuDecision: evaluation?.decision || "accept",
    cpuScore: Number(evaluation?.score || 0),
    evaluationSummary: {
      decision: evaluation?.decision || "accept",
      accepted: hasAcceptedEvaluation(evaluation),
      score: Number(evaluation?.score || 0),
      message: evaluation?.message || "",
      reasons: Array.isArray(evaluation?.reasons) ? evaluation.reasons.slice(0, 6) : [],
    },
  };

  nextLeague.tradeHistory = [...(Array.isArray(nextLeague.tradeHistory) ? nextLeague.tradeHistory : []), tradeRecord];
  nextLeague.lastTrade = tradeRecord;

  clearSavedGameplanForTeam(userTeamName);
  clearSavedGameplanForTeam(cpuTeamName);

  return { ok: true, leagueData: nextLeague, tradeRecord };
}



export function executeCpuTradeCandidateOnLeague({ leagueData, candidate }) {
  const fromTeamName = candidate?.fromTeamName || candidate?.sellerTeamName || candidate?.teamA || "";
  const toTeamName = candidate?.toTeamName || candidate?.buyerTeamName || candidate?.teamB || "";
  const fromItems = Array.isArray(candidate?.fromItems) ? candidate.fromItems : [];
  const toItems = Array.isArray(candidate?.toItems) ? candidate.toItems : [];

  if (!leagueData || !fromTeamName || !toTeamName) {
    return { ok: false, reason: "CPU trade candidate is missing one or both teams." };
  }

  const fromTeam = findTeamInLeague(leagueData, fromTeamName);
  const toTeam = findTeamInLeague(leagueData, toTeamName);

  if (!fromTeam || !toTeam) {
    return { ok: false, reason: "CPU trade candidate referenced a team that no longer exists." };
  }

  if (!fromItems.length || !toItems.length) {
    return { ok: false, reason: "CPU trade candidate needs assets from both teams." };
  }

  const fromRosterProjection = getProjectedStandardRosterCount(fromTeam, fromItems, toItems);
  const toRosterProjection = getProjectedStandardRosterCount(toTeam, toItems, fromItems);
  if (fromRosterProjection.projected < 14 || toRosterProjection.projected < 14) {
    return {
      ok: false,
      reason: "CPU trade rejected because it would leave a team below the 14-player regular-season minimum.",
      fromRosterProjection,
      toRosterProjection,
    };
  }

  const toTeamView = evaluateTradeTeamImpact({
    leagueData,
    userTeam: fromTeam,
    cpuTeam: toTeam,
    userTeamName: fromTeamName,
    cpuTeamName: toTeamName,
    userItems: fromItems,
    cpuItems: toItems,
    evaluationMode: "cpu_cpu_trade",
    cpuTradeRole: "buyer",
    cpuTradeContext: candidate?.debug || {},
  });

  if (!hasAcceptedEvaluation(toTeamView)) {
    return {
      ok: false,
      reason: toTeamView?.message || `${toTeamName} rejected the CPU trade candidate.`,
      toTeamView,
    };
  }

  const fromTeamView = evaluateTradeTeamImpact({
    leagueData,
    userTeam: toTeam,
    cpuTeam: fromTeam,
    userTeamName: toTeamName,
    cpuTeamName: fromTeamName,
    userItems: toItems,
    cpuItems: fromItems,
    evaluationMode: "cpu_cpu_trade",
    cpuTradeRole: "seller",
    cpuTradeContext: candidate?.debug || {},
  });

  if (!hasAcceptedEvaluation(fromTeamView)) {
    return {
      ok: false,
      reason: fromTeamView?.message || `${fromTeamName} rejected the CPU trade candidate.`,
      fromTeamView,
      toTeamView,
    };
  }

  const execution = executeAcceptedTradeOnLeague({
    leagueData,
    userTeamName: fromTeamName,
    cpuTeamName: toTeamName,
    userItems: fromItems,
    cpuItems: toItems,
    evaluation: {
      accepted: true,
      decision: "accept",
      score: Number(toTeamView?.score || 0) + Number(fromTeamView?.score || 0),
      reasons: [
        candidate?.motive || "CPU-to-CPU trade matched both teams' direction.",
        ...(Array.isArray(toTeamView?.reasons) ? toTeamView.reasons.slice(0, 2) : []),
        ...(Array.isArray(fromTeamView?.reasons) ? fromTeamView.reasons.slice(0, 2) : []),
      ],
    },
  });

  if (!execution.ok) {
    return { ...execution, fromTeamView, toTeamView };
  }

  const cpuTiming = getTradeTimingSnapshot(leagueData);
  const buyerReason = reasonFromTeamView(
    toTeamName,
    toTeamView,
    candidate?.motive || `${toTeamName} wanted to add ${summarizeAssetsForReason(fromItems)}.`
  );
  const sellerReason = reasonFromTeamView(
    fromTeamName,
    fromTeamView,
    candidate?.motive || `${fromTeamName} wanted to add ${summarizeAssetsForReason(toItems)}.`
  );
  const cpuReasoning = {
    ...((execution.tradeRecord || {}).reasoning || {}),
    [fromTeamName]: sellerReason,
    [toTeamName]: buyerReason,
  };

  const tradeRecord = {
    ...(execution.tradeRecord || {}),
    source: "cpu_cpu_trade",
    cpuCpuTrade: true,
    fromTeamName,
    toTeamName,
    date: candidate?.currentDate || candidate?.date || (execution.tradeRecord || {}).date || cpuTiming.date,
    currentDate: candidate?.currentDate || candidate?.date || (execution.tradeRecord || {}).currentDate || cpuTiming.currentDate,
    day: candidate?.day || candidate?.currentDay || candidate?.dayIndex || (execution.tradeRecord || {}).day || cpuTiming.day,
    dayIndex: candidate?.dayIndex || candidate?.day || candidate?.currentDay || (execution.tradeRecord || {}).dayIndex || cpuTiming.dayIndex,
    motive: candidate?.motive || "",
    reasoning: cpuReasoning,
    teamPackages: Array.isArray((execution.tradeRecord || {}).teamPackages)
      ? (execution.tradeRecord || {}).teamPackages.map((side) => ({
          ...side,
          reason: cpuReasoning[side.teamName] || side.reason,
        }))
      : (execution.tradeRecord || {}).teamPackages,
    fromTeamView,
    toTeamView,
  };

  return {
    ...execution,
    leagueData: {
      ...execution.leagueData,
      tradeHistory: [
        ...(Array.isArray(execution.leagueData?.tradeHistory)
          ? execution.leagueData.tradeHistory.slice(0, -1)
          : []),
        tradeRecord,
      ],
      lastTrade: tradeRecord,
    },
    tradeRecord,
    fromTeamView,
    toTeamView,
  };
}

export {
  executeAcceptedTradeOnLeague,
  validateTradeForExecution,
  evaluateTradeFinancialLegality,
  getPlayerSalary,
  sideSalary,
  summarizeTradeItems,
};
