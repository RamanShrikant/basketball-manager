import { computeTeamRatings } from "../api/teamRatings.js";
import { getLeagueFinancialRules } from "./leagueFinancials.js";
import { buildSmartRotation } from "./ensureGameplans.js";
import { evaluateTradeTeamImpact } from "./tradeTeamImpact.js";
import { findIneligibleTradePlayer } from "./tradeRosterEligibility.js";
import {
  evaluateTradeRosterProjection,
  projectStandardRosterCount,
} from "./rosterRules.js";
import {
  buildTradeMachineSwapAssets,
  getTradeablePickOwnedRange,
  makeTradeGeneratedDraftPickId,
  normalizeDraftPickAsset,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  validateCustomPickProtection,
} from "./draftPicks.js";
import { getContractSeasonYear } from "./seasonContext.js";
import {
  getUserTradeCurrentDate,
  getUserTradeRuleSettings,
  stampUserTradeAcquisitionRestrictions,
  validateUserTradeAssetPackage,
  validateUserTradeRules,
} from "./userTradeRules.js";

// Shared trade execution helpers.
// ProposeTrade and CPU-to-CPU trades can use the same movement, salary, roster,
// protected-pick, swap, and draft-order ownership logic.

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const TRADE_DEADLINE_STATUS_KEY = "bm_trade_deadline_status_v1";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const MAX_SIDE_ITEMS = 8;
const TRADE_MATCHING_SMALL_OUTGOING = 7_500_000;
const TRADE_MATCHING_MID_OUTGOING = 29_000_000;
const TRADE_MATCHING_BUFFER = 250_000;
const TRADE_SALARY_TOLERANCE = 1_000;
const CPU_CPU_RECENT_ACQUISITION_COOLDOWN_DAYS = 45;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


const MEGA_HEALTHY_POWER_PROTECTION_RANK = 14;
const megaHealthyPowerRatingsCacheForExecution = new WeakMap();

function getMegaHealthyPowerRosterSignatureForExecution(team = {}) {
  return [
    "mega-healthy-power-rankings-v2",
    ...(Array.isArray(team?.players) ? team.players : [])
      .map((player) => [
        player?.name || player?.player || "",
        player?.pos || player?.position || "",
        player?.secondaryPos || "",
        finiteNumber(player?.overall ?? player?.ovr ?? player?.rating, 0),
        finiteNumber(player?.offRating ?? player?.off ?? player?.offense, 0),
        finiteNumber(player?.defRating ?? player?.def ?? player?.defense, 0),
        finiteNumber(player?.stamina, 75),
        finiteNumber(player?.potential ?? player?.pot, 0),
        finiteNumber(player?.age, 0),
      ].join("|"))
      .sort(),
  ].join("||");
}

function buildMegaHealthyFallbackMinutesForExecution(team = {}) {
  const players = [...(Array.isArray(team?.players) ? team.players : [])]
    .filter((player) => player?.name || player?.player)
    .sort((a, b) => finiteNumber(b?.overall ?? b?.ovr ?? b?.rating, 0) - finiteNumber(a?.overall ?? a?.ovr ?? a?.rating, 0));
  const minuteSlots = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];
  const minutes = {};
  for (let index = 0; index < Math.min(players.length, minuteSlots.length); index += 1) {
    const name = players[index]?.name || players[index]?.player;
    if (name) minutes[name] = minuteSlots[index];
  }
  return minutes;
}

function getMegaHealthyPowerRankingsOverallForExecution(team = {}) {
  const fallback = teamTopOvrForMega(team, 8);
  if (!team || typeof team !== "object") return fallback;
  const signature = getMegaHealthyPowerRosterSignatureForExecution(team);
  const cached = megaHealthyPowerRatingsCacheForExecution.get(team);
  if (cached?.signature === signature) return cached.overall;

  let overall = fallback;
  try {
    const built = buildSmartRotation(Array.isArray(team?.players) ? team.players : []);
    const minutes = built?.obj && typeof built.obj === "object"
      ? built.obj
      : buildMegaHealthyFallbackMinutesForExecution(team);
    const ratings = computeTeamRatings(team, minutes);
    const powerRankingsOverall = finiteNumber(ratings?.exactOverall ?? ratings?.overall, fallback);
    if (powerRankingsOverall > 0) overall = powerRankingsOverall;
  } catch {
    overall = fallback;
  }

  megaHealthyPowerRatingsCacheForExecution.set(team, { signature, overall });
  return overall;
}


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
    const startYear = Number(contract.startYear || payrollSeasonYear);
    const idx = payrollSeasonYear - startYear;
    if (idx >= 0 && idx < salaries.length) return Number(salaries[idx] || 0);
    return 0;
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
  return getContractSeasonYear(leagueData || {});
}

function getPlayerSalary(player, leagueData) {
  return getSalaryForPayrollYear(player, getTradePayrollSeasonYear(leagueData));
}

function getContractYearsRemaining(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;

  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);
  const startYear = Number(contract.startYear || payrollSeasonYear);
  const idx = payrollSeasonYear - startYear;
  if (!Number.isFinite(idx) || idx < 0) return salaries.length;
  if (idx >= salaries.length) return 0;
  return salaries.length - idx;
}

function getContractTotalRemaining(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => Number(value) || 0)
    : [];
  if (!salaries.length) return getPlayerSalary(player, leagueData);

  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);
  const startYear = Number(contract.startYear || payrollSeasonYear);
  const idx = payrollSeasonYear - startYear;
  if (!Number.isFinite(idx) || idx < 0) return salaries.reduce((sum, value) => sum + Number(value || 0), 0);
  if (idx >= salaries.length) return 0;

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
  const attached = leagueData?.__offseasonTradeContext;
  if (attached && typeof attached === "object" && attached.version) {
    return {
      ...attached,
      enforceRegularSeasonRosterLimits: !attached.inOffseason,
    };
  }
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

function asDraftRowObject(row = {}) {
  return row && typeof row === "object" ? row : {};
}

function getPickNumberFromAny(row = {}) {
  const safeRow = asDraftRowObject(row);
  const n = Number(safeRow.pick ?? safeRow.pickNumber ?? safeRow.overallPick ?? safeRow.draftPickNumber ?? safeRow.resolvedPickNumber ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getRoundFromAny(row = {}) {
  const safeRow = asDraftRowObject(row);
  const explicit = Number(safeRow.round || safeRow.roundNum || safeRow.pickRound || 0);
  if (explicit === 1 || explicit === 2) return explicit;
  const pickNumber = getPickNumberFromAny(safeRow);
  return pickNumber && pickNumber <= 30 ? 1 : 2;
}

function getOriginalTeamFromAny(row = {}) {
  const safeRow = asDraftRowObject(row);
  return safeRow.originalTeam || safeRow.originalTeamName || safeRow.originalPickTeamName || safeRow.naturalLotteryTeamName || safeRow.team || safeRow.teamName || "";
}

function getOwnerTeamFromDraftRow(row = {}) {
  const safeRow = asDraftRowObject(row);
  return safeRow.currentOwnerTeamName || safeRow.ownerTeamName || safeRow.ownerTeam || safeRow.owner || safeRow.currentOwner || safeRow.teamName || "";
}

function getLockedDraftOrder(leagueData, seasonYear = getCurrentSeasonYear(leagueData)) {
  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return direct;

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (leagueData?.draftState?.draftLotteryComplete && Array.isArray(lotteryOrder) && lotteryOrder.length) {
    return lotteryOrder;
  }

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
  if (!row || typeof row !== "object" || !pick || typeof pick !== "object") return false;
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
  if (!row || typeof row !== "object") return row;
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
    if (!row || typeof row !== "object") return row;
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

function recordForTeamName(recordsByTeam = {}, teamName = "") {
  if (!recordsByTeam || typeof recordsByTeam !== "object" || !teamName) return null;
  const key = Object.keys(recordsByTeam).find((name) => sameTeamName(name, teamName));
  return key ? recordsByTeam[key] : null;
}

function megaWinPct(recordsByTeam = {}, teamName = "") {
  const row = recordForTeamName(recordsByTeam, teamName) || {};
  const wins = finiteNumber(row.wins ?? row.w, 0);
  const losses = finiteNumber(row.losses ?? row.l, 0);
  const games = finiteNumber(row.games ?? row.gp, wins + losses);
  if (games <= 0) return null;
  return wins / Math.max(1, wins + losses || games);
}

function megaGamesPlayed(recordsByTeam = {}, teamName = "") {
  const row = recordForTeamName(recordsByTeam, teamName) || {};
  const wins = finiteNumber(row.wins ?? row.w, 0);
  const losses = finiteNumber(row.losses ?? row.l, 0);
  return finiteNumber(row.games ?? row.gp, wins + losses);
}

function teamTopOvrForMega(team = {}, count = 6) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const values = players
    .map((player) => finiteNumber(player?.overall ?? player?.ovr ?? player?.rating, 0))
    .filter((value) => value > 0)
    .sort((a, b) => b - a)
    .slice(0, count);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function conferenceRankForMegaSeller(leagueData = {}, recordsByTeam = {}, teamName = "") {
  if (!leagueData?.conferences || typeof leagueData.conferences !== "object" || !teamName) return null;
  for (const rows of Object.values(leagueData.conferences)) {
    if (!Array.isArray(rows) || !rows.some((team) => sameTeamName(team?.name || team?.teamName, teamName))) continue;
    const ranked = [...rows].sort((a, b) => {
      const ap = megaWinPct(recordsByTeam, a?.name || a?.teamName);
      const bp = megaWinPct(recordsByTeam, b?.name || b?.teamName);
      const ar = recordForTeamName(recordsByTeam, a?.name || a?.teamName) || {};
      const br = recordForTeamName(recordsByTeam, b?.name || b?.teamName) || {};
      if ((bp ?? -1) !== (ap ?? -1)) return (bp ?? -1) - (ap ?? -1);
      return finiteNumber(br.wins ?? br.w, 0) - finiteNumber(ar.wins ?? ar.w, 0);
    });
    const index = ranked.findIndex((team) => sameTeamName(team?.name || team?.teamName, teamName));
    return index >= 0 ? index + 1 : null;
  }
  return null;
}

function megaLeagueRankForSeller(leagueData = {}, recordsByTeam = {}, sellerName = "") {
  const teams = getAllTeamsFromLeague(leagueData);
  if (!sellerName || !teams.length) return null;
  const rows = teams.map((team) => {
    const name = team?.name || team?.teamName || "";
    return {
      name,
      pct: megaWinPct(recordsByTeam, name),
      games: megaGamesPlayed(recordsByTeam, name),
      power: teamTopOvrForMega(team, 6),
    };
  });
  const useRecord = rows.filter((row) => row.games >= 20).length >= Math.max(1, Math.ceil(rows.length * 0.8));
  rows.sort((a, b) => {
    const aScore = useRecord ? (a.pct ?? 0) * 50 + a.power * 0.5 : a.power;
    const bScore = useRecord ? (b.pct ?? 0) * 50 + b.power * 0.5 : b.power;
    if (bScore !== aScore) return bScore - aScore;
    if ((b.pct ?? -1) !== (a.pct ?? -1)) return (b.pct ?? -1) - (a.pct ?? -1);
    return b.power - a.power;
  });
  const index = rows.findIndex((row) => sameTeamName(row.name, sellerName));
  return index >= 0 ? index + 1 : null;
}


function megaHealthyPowerRankForSeller(leagueData = {}, sellerName = "") {
  const rows = getAllTeamsFromLeague(leagueData)
    .map((team) => ({
      name: team?.name || team?.teamName || "",
      power: getMegaHealthyPowerRankingsOverallForExecution(team),
    }))
    .filter((row) => row.name && row.power > 0)
    .sort((a, b) => b.power - a.power);
  const index = rows.findIndex((row) => sameTeamName(row.name, sellerName));
  return index >= 0 ? index + 1 : null;
}

function megaSellerDirectionForExecution(leagueData = {}, recordsByTeam = {}, sellerTeam = {}) {
  const sellerName = sellerTeam?.name || sellerTeam?.teamName || "";
  const games = megaGamesPlayed(recordsByTeam, sellerName);
  const pct = megaWinPct(recordsByTeam, sellerName);
  const conferenceRank = conferenceRankForMegaSeller(leagueData, recordsByTeam, sellerName);
  const leagueRank = megaLeagueRankForSeller(leagueData, recordsByTeam, sellerName);
  const healthyPowerRank = megaHealthyPowerRankForSeller(leagueData, sellerName);
  let phase = "middle";
  if (conferenceRank != null) {
    if (conferenceRank >= 12) phase = "rebuilding";
    else if (conferenceRank >= 8) phase = "retooling";
    else phase = "contending";
  } else if ((pct != null && pct <= 0.38) || (leagueRank != null && leagueRank >= 24)) {
    phase = "rebuilding";
  } else if ((pct != null && pct < 0.5) || (leagueRank != null && leagueRank >= 16)) {
    phase = "retooling";
  }
  const under500 = pct != null && pct < 0.5;
  const bottomHalf = leagueRank != null && leagueRank >= 16;
  const protectedHealthyCore = healthyPowerRank != null && healthyPowerRank <= MEGA_HEALTHY_POWER_PROTECTION_RANK;
  return {
    phase,
    games,
    pct,
    conferenceRank,
    leagueRank,
    healthyPowerRank,
    protectedHealthyCore,
    eligible: !protectedHealthyCore && (phase === "retooling" || phase === "rebuilding" || under500 || bottomHalf),
  };
}

function strictMegaSellerExecutionBlockReason(leagueData = {}, recordsByTeam = {}, sellerTeam = {}, targetPlayer = null) {
  const direction = megaSellerDirectionForExecution(leagueData, recordsByTeam, sellerTeam);
  if (direction.conferenceRank != null && direction.conferenceRank <= 7) return "seller_top7_conference";
  if (direction.protectedHealthyCore) return "seller_top14_healthy_power_rankings_ovr";
  if (!direction.eligible) return "seller_not_mid_bad_retool_or_rebuild";
  if (targetPlayer) {
    const ovr = finiteNumber(targetPlayer?.overall ?? targetPlayer?.ovr ?? targetPlayer?.rating, 0);
    const age = finiteNumber(targetPlayer?.age ?? targetPlayer?.playerAge, 27);
    if (ovr < 90) return "mega_target_below_90";
    if (age < 28) return "mega_target_too_young";
    if (direction.phase !== "rebuilding" && ovr >= 94 && age <= 30) {
      return "retool_or_mid_protects_prime_94_plus";
    }
  }
  return "";
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


function getProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  return projectStandardRosterCount(team, outgoingItems, incomingItems);
}

function validateProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  const projection = evaluateTradeRosterProjection({
    team,
    outgoingItems,
    incomingItems,
    inOffseason: false,
  });

  if (!projection.ok) {
    return {
      ok: false,
      reason: `${projection.reason} Unequal player counts are allowed, but a trade cannot create more than ${projection.allowedMax} standard contracts.`,
      counts: { ...projection.counts, allowedMax: projection.allowedMax },
      projection,
    };
  }

  return {
    ok: true,
    counts: { ...projection.counts, allowedMax: projection.allowedMax },
    projection,
    requiresRepairBeforeSimulation: projection.requiresRepairBeforeSimulation,
  };
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

function validateTradeForExecution({ leagueData, userTeam, cpuTeam, userItems, cpuItems, evaluation, userDrivenRules = false, inOffseason = null }) {
  if (!hasAcceptedEvaluation(evaluation)) {
    return { ok: false, reason: "CPU must accept the proposal before it can be submitted." };
  }

  if (!userTeam || !cpuTeam) {
    return { ok: false, reason: "Both teams must still exist in the league save." };
  }

  if (!userItems.length || !cpuItems.length) {
    return { ok: false, reason: "Add at least one asset from each side before submitting." };
  }

  const userAssetCount = cpuPackageAssetCount(userItems);
  const cpuAssetCount = cpuPackageAssetCount(cpuItems);
  if (userAssetCount > MAX_SIDE_ITEMS || cpuAssetCount > MAX_SIDE_ITEMS) {
    return {
      ok: false,
      reason: `Trades are limited to ${MAX_SIDE_ITEMS} assets per team.`,
      staleCode: "too_many_assets",
    };
  }

  const ineligibleUserPlayer = findIneligibleTradePlayer(userItems, { leagueData, inOffseason });
  if (ineligibleUserPlayer) {
    const name = playerNameOf(ineligibleUserPlayer.item?.player);
    return { ok: false, reason: `${name} cannot be traded: ${ineligibleUserPlayer.eligibility?.reason || "the player is not under a guaranteed contract for next season."}` };
  }

  const ineligibleCpuPlayer = findIneligibleTradePlayer(cpuItems, { leagueData, inOffseason });
  if (ineligibleCpuPlayer) {
    const name = playerNameOf(ineligibleCpuPlayer.item?.player);
    return { ok: false, reason: `${name} cannot be traded: ${ineligibleCpuPlayer.eligibility?.reason || "the player is not under a guaranteed contract for next season."}` };
  }

  if (userDrivenRules) {
    const userRuleValidation = validateUserTradeRules({
      leagueData,
      userTeam,
      cpuTeam,
      userTeamName: userTeam?.name || userTeam?.teamName || "",
      cpuTeamName: cpuTeam?.name || cpuTeam?.teamName || "",
      userItems,
      cpuItems,
      includeDeadline: true,
      includeFinancial: true,
    });
    if (!userRuleValidation.ok) return userRuleValidation;
  }

  if (!userDrivenRules) {
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
    getUserTradeCurrentDate(leagueData) ||
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

function isGenericTradeDecisionMessage(text = "") {
  const normalized = normalizeTradeReasonText(text).toLowerCase();
  return /\b(accepts|rejects) the proposal\.?$/.test(normalized);
}

function stripAcceptedReasonPrefix(text = "") {
  return normalizeTradeReasonText(text)
    .replace(/^accepted because\s+/i, "")
    .replace(/^accepted in cpu-to-cpu buyer mode because\s+/i, "")
    .replace(/^accepted in cpu-to-cpu seller mode because\s+/i, "")
    .replace(/^accepted in cpu-to-cpu cpu mode because\s+/i, "")
    .replace(/^accepted in [^:]+ mode because\s+/i, "");
}

function firstEvaluationReason(evaluation = {}, fallback = "") {
  const message = normalizeTradeReasonText(evaluation?.message);
  if (message && !isGenericTradeDecisionMessage(message)) return message;

  const reasons = Array.isArray(evaluation?.reasons)
    ? evaluation.reasons.map(normalizeTradeReasonText).filter(Boolean)
    : [];

  const acceptedReason = reasons.find((reason) => /^accepted (because|in)\b/i.test(reason));
  if (acceptedReason) return stripAcceptedReasonPrefix(acceptedReason);

  const strategicReason = reasons.find((reason) =>
    /(rotation upgrade|future\/upside|draft-pick value|team-impact score|no draft-asset downside|contract downside|clear reason to trade)/i.test(reason)
  );
  if (strategicReason) return stripAcceptedReasonPrefix(strategicReason);

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

function executeAcceptedTradeOnLeague({ leagueData, userTeamName, cpuTeamName, userItems, cpuItems, evaluation, userDrivenRules = false, inOffseason = null }) {
  const userTeam = findTeamInLeague(leagueData, userTeamName);
  const cpuTeam = findTeamInLeague(leagueData, cpuTeamName);
  const validation = validateTradeForExecution({ leagueData, userTeam, cpuTeam, userItems, cpuItems, evaluation, userDrivenRules, inOffseason });
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

  const finalizedLeague = userDrivenRules
    ? stampUserTradeAcquisitionRestrictions({
        leagueData: nextLeague,
        movedPlayers,
        currentDate: timing.currentDate || timing.date,
        source: "user_trade",
        sourceTransactionId: tradeRecord.id,
      })
    : nextLeague;

  clearSavedGameplanForTeam(userTeamName);
  clearSavedGameplanForTeam(cpuTeamName);

  return { ok: true, leagueData: finalizedLeague, tradeRecord };
}



function resolveCurrentCpuTradePlayerItem(leagueData, teamName, item = {}) {
  const team = findTeamInLeague(leagueData, teamName);
  if (!team) {
    return { ok: false, reason: `CPU trade candidate referenced ${teamName}, but that team no longer exists.` };
  }

  const requestedPlayer = item?.player || {};
  const playerIndex = findStandardPlayerIndex(team, requestedPlayer);
  if (playerIndex < 0) {
    return {
      ok: false,
      reason: `${playerNameOf(requestedPlayer)} is no longer on ${teamName}'s standard roster.`,
      staleCode: "player_ownership_changed",
    };
  }

  return {
    ok: true,
    item: {
      ...item,
      type: "player",
      teamName,
      player: team.players[playerIndex],
    },
  };
}

function resolveCurrentCpuTradePickItem(leagueData, teamName, item = {}) {
  const rows = Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [];
  const teamNames = getTeamNamesForDraftPickMatch(leagueData);
  const requestedPick = item?.pick || {};
  const rowIndex = rows.findIndex((row, index) =>
    pickIdentityMatches(normalizeDraftPickAsset(row, index, teamNames), requestedPick, teamName)
  );

  if (rowIndex < 0) {
    return {
      ok: false,
      reason: `${teamName} no longer owns ${formatPick(requestedPick)}.`,
      staleCode: "pick_ownership_changed",
    };
  }

  const normalized = normalizeDraftPickAsset(rows[rowIndex], rowIndex, teamNames);
  if (!sameTeamName(normalized.ownerTeam, teamName)) {
    return {
      ok: false,
      reason: `${teamName} no longer owns ${formatPick(requestedPick)}.`,
      staleCode: "pick_ownership_changed",
    };
  }

  return {
    ok: true,
    item: {
      ...item,
      type: "pick",
      teamName,
      pick: {
        ...rows[rowIndex],
        ...normalized,
      },
    },
  };
}

function resolveCurrentCpuTradeItems(leagueData, teamName, items = []) {
  const resolvedItems = [];

  for (const item of items || []) {
    const result = item?.type === "player"
      ? resolveCurrentCpuTradePlayerItem(leagueData, teamName, item)
      : item?.type === "pick"
        ? resolveCurrentCpuTradePickItem(leagueData, teamName, item)
        : { ok: false, reason: "CPU trade candidate contains an unsupported asset type.", staleCode: "unsupported_asset" };

    if (!result.ok) return result;
    resolvedItems.push(result.item);
  }

  return { ok: true, items: resolvedItems };
}

const CPU_STEPIEN_ONLY_SETTINGS = {
  tradeDeadline: false,
  salaryMatching: false,
  firstApron: false,
  secondApron: false,
  hardCapApronCeiling: false,
  stepienRule: true,
  recentlyAcquired: false,
  recentlySigned: false,
  newlyDraftedRookie: false,
  recentlyExtended: false,
};

function cpuPickKey(item = {}) {
  const pick = item?.pick || item || {};
  return [
    pick?.id || pick?.pickId || "",
    Number(pick?.year || pick?.seasonYear || 0),
    Number(pick?.round || 0),
    normalizeTeamName(pick?.ownerTeam || pick?.owner || pick?.currentOwnerTeamName || item?.teamName || ""),
    normalizeTeamName(pick?.originalTeam || pick?.originalTeamName || ""),
    normalizeTeamName(pick?.swapWithTeam || pick?.swapTeam || pick?.swapWith || ""),
  ].join("|");
}

function isFutureFirstTradeItem(item = {}) {
  const pick = item?.pick || {};
  const round = Number(pick?.round || 0);
  const type = String(pick?.type || pick?.assetType || "").toLowerCase();
  if (round !== 1) return false;
  return type !== "resolved" && type !== "current";
}

function getCpuOwnedFirstRoundPickItems(leagueData = {}, teamName = "", usedKeys = new Set()) {
  const teamNames = getTeamNamesForDraftPickMatch(leagueData);
  const teamKey = normalizeTeamName(teamName);
  const seasonYear = getContractSeasonYear(leagueData || {});
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [])
    .map((row, index) => normalizeDraftPickAsset(row, index, teamNames))
    .filter((pick) => String(pick?.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick?.round || 0) === 1)
    .filter((pick) => Number(pick?.year || pick?.seasonYear || 0) >= Number(seasonYear || 0) + 1)
    .filter((pick) => normalizeTeamName(pick?.ownerTeam || pick?.owner || "") === teamKey)
    .map((pick) => ({ type: "pick", teamName, pick, protection: pick?.displayProtection || pick?.protection || "Unprotected" }))
    .filter((item) => !usedKeys.has(cpuPickKey(item)))
    .sort((a, b) => Number(a.pick?.year || 0) - Number(b.pick?.year || 0));
}

function getCpuOwnedSecondRoundPickItems(leagueData = {}, teamName = "", usedKeys = new Set()) {
  const teamNames = getTeamNamesForDraftPickMatch(leagueData);
  const teamKey = normalizeTeamName(teamName);
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [])
    .map((row, index) => normalizeDraftPickAsset(row, index, teamNames))
    .filter((pick) => String(pick?.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick?.round || 0) === 2)
    .filter((pick) => normalizeTeamName(pick?.ownerTeam || pick?.owner || "") === teamKey)
    .map((pick) => ({ type: "pick", teamName, pick, protection: pick?.displayProtection || pick?.protection || "Unprotected" }))
    .filter((item) => !usedKeys.has(cpuPickKey(item)))
    .sort((a, b) => Number(a.pick?.year || 0) - Number(b.pick?.year || 0));
}

function cpuStepienPackageValidation(leagueData, teamName, outgoingItems, incomingItems) {
  return validateUserTradeAssetPackage({
    leagueData,
    teamName,
    outgoingItems,
    incomingItems,
    settings: CPU_STEPIEN_ONLY_SETTINGS,
  });
}

function isCountableCpuTradeItem(item = {}) {
  return Boolean(item && !item?.tradeRule?.mirror && !item?.tradeValueExcluded);
}

function cpuPackageAssetCount(items = []) {
  return (Array.isArray(items) ? items : []).filter(isCountableCpuTradeItem).length;
}

function isCpuFutureFirstItem(item = {}) {
  return Boolean(item?.type === "pick" && item.pick && isFutureFirstTradeItem(item));
}

function isCpuSecondRoundPickItem(item = {}) {
  return Boolean(item?.type === "pick" && Number(item?.pick?.round || 0) === 2);
}

function cpuPickYear(item = {}) {
  return Number(item?.pick?.year || item?.pick?.seasonYear || 0) || 0;
}

function cpuPickProtectionText(item = {}) {
  return String(
    item?.protection ||
      item?.pick?.displayProtection ||
      item?.pick?.protection ||
      item?.pick?.protections ||
      ""
  ).toLowerCase();
}

function isCpuGuaranteedFirstLike(item = {}) {
  if (!isCpuFutureFirstItem(item)) return false;
  const pick = item?.pick || {};
  const type = String(pick?.type || pick?.assetType || "").toLowerCase();
  const label = cpuPickProtectionText(item);
  const isSwap = type.includes("swap") || Boolean(pick?.swapWithTeam || pick?.swapTeam || pick?.swapWith);
  if (isSwap) return true;
  if (label.includes("protect") && !label.includes("unprotected")) return false;
  return true;
}

function cpuRepairedItemSortScore(item = {}, originalFirstKeys = new Set()) {
  if (item?.type === "player") {
    const ovr = Number(item?.player?.ovr ?? item?.player?.overall ?? 0) || 0;
    return 100000 + ovr * 100;
  }
  if (isCpuFutureFirstItem(item)) {
    const originalBonus = originalFirstKeys.has(cpuPickKey(item)) ? 8000 : 0;
    const guaranteeBonus = isCpuGuaranteedFirstLike(item) ? 1800 : 600;
    return 50000 + originalBonus + guaranteeBonus - Math.abs(cpuPickYear(item) - 2029) * 35;
  }
  if (isCpuSecondRoundPickItem(item)) {
    return 10000 - Math.abs(cpuPickYear(item) - 2029) * 10;
  }
  if (item?.type === "pick") return 20000;
  return 0;
}

function capCpuPackageToMax(items = [], originalFirstKeys = new Set(), maxItems = MAX_SIDE_ITEMS) {
  const raw = Array.isArray(items) ? items.filter(Boolean) : [];
  const countable = raw.filter(isCountableCpuTradeItem);
  if (countable.length <= maxItems) return raw;

  const keep = countable
    .map((item, index) => ({ item, index, score: cpuRepairedItemSortScore(item, originalFirstKeys) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxItems)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.item);

  const keepKeys = new Set(keep.map((item) => `${item?.type || ""}:${cpuPickKey(item)}:${item?.player?.id || item?.player?.name || ""}`));
  const nonCountable = raw.filter((item) => !isCountableCpuTradeItem(item));
  return [...keep, ...nonCountable].filter((item) => {
    if (!isCountableCpuTradeItem(item)) return true;
    return keepKeys.has(`${item?.type || ""}:${cpuPickKey(item)}:${item?.player?.id || item?.player?.name || ""}`);
  });
}

function getCpuCombinationScore(combo = [], originalFirstKeys = new Set()) {
  return combo.reduce((sum, item) => sum + cpuRepairedItemSortScore(item, originalFirstKeys), 0);
}

function generateCpuFirstCombos(pool = [], targetCount = 0, limit = 1000) {
  const out = [];
  const chosen = [];
  const count = Math.max(0, Math.trunc(targetCount || 0));
  if (count === 0) return [[]];
  if (!Array.isArray(pool) || pool.length < count) return [];

  function walk(start) {
    if (out.length >= limit) return;
    if (chosen.length === count) {
      out.push([...chosen]);
      return;
    }
    const remainingNeeded = count - chosen.length;
    for (let i = start; i <= pool.length - remainingNeeded; i += 1) {
      chosen.push(pool[i]);
      walk(i + 1);
      chosen.pop();
      if (out.length >= limit) return;
    }
  }

  walk(0);
  return out;
}

function buildCpuTrialPackage({
  leagueData,
  teamName,
  baseItems = [],
  firstCombo = [],
  originalNonFirstPicks = [],
  originalFirstKeys = new Set(),
} = {}) {
  const packageItems = [];
  const usedKeys = new Set();
  const add = (item) => {
    if (!item) return;
    if (isCountableCpuTradeItem(item) && cpuPackageAssetCount(packageItems) >= MAX_SIDE_ITEMS) return;
    const key = item?.type === "pick" ? `pick:${cpuPickKey(item)}` : `player:${item?.player?.id || item?.player?.name || Math.random()}`;
    if (usedKeys.has(key)) return;
    packageItems.push(item);
    usedKeys.add(key);
  };

  (baseItems || []).forEach(add);
  (firstCombo || []).forEach(add);

  const originalFillers = [...(originalNonFirstPicks || [])]
    .filter((item) => !usedKeys.has(`pick:${cpuPickKey(item)}`))
    .sort((a, b) => cpuRepairedItemSortScore(b, originalFirstKeys) - cpuRepairedItemSortScore(a, originalFirstKeys));
  originalFillers.forEach(add);

  if (cpuPackageAssetCount(packageItems) < MAX_SIDE_ITEMS) {
    const secondPool = getCpuOwnedSecondRoundPickItems(leagueData, teamName, new Set(packageItems.filter((item) => item?.type === "pick").map(cpuPickKey)))
      .sort((a, b) => cpuRepairedItemSortScore(b, originalFirstKeys) - cpuRepairedItemSortScore(a, originalFirstKeys));
    secondPool.forEach(add);
  }

  return capCpuPackageToMax(packageItems, originalFirstKeys, MAX_SIDE_ITEMS);
}

function buildCpuGreedyFirstCombo(pool = [], count = 0, mode = "balanced", originalFirstKeys = new Set()) {
  const wanted = Math.max(0, Math.trunc(count || 0));
  if (!wanted) return [];
  const rows = (Array.isArray(pool) ? pool : []).filter(Boolean);
  if (rows.length < wanted) return [];

  let sorted;
  if (mode === "preserve_original") {
    sorted = [...rows].sort((a, b) => {
      const aOriginal = originalFirstKeys.has(cpuPickKey(a)) ? 1 : 0;
      const bOriginal = originalFirstKeys.has(cpuPickKey(b)) ? 1 : 0;
      if (aOriginal !== bOriginal) return bOriginal - aOriginal;
      return cpuPickYear(a) - cpuPickYear(b);
    });
  } else if (mode === "later_years") {
    sorted = [...rows].sort((a, b) => cpuPickYear(b) - cpuPickYear(a));
  } else {
    sorted = [...rows].sort((a, b) => {
      const aScore = cpuRepairedItemSortScore(a, originalFirstKeys);
      const bScore = cpuRepairedItemSortScore(b, originalFirstKeys);
      return bScore - aScore || cpuPickYear(a) - cpuPickYear(b);
    });
  }

  const chosen = [];
  const usedYears = new Set();
  for (const item of sorted) {
    const year = cpuPickYear(item);
    if (!year) continue;
    if (usedYears.has(year) || usedYears.has(year - 1) || usedYears.has(year + 1)) continue;
    chosen.push(item);
    usedYears.add(year);
    if (chosen.length >= wanted) break;
  }
  return chosen.length >= wanted ? chosen : [];
}

function repairCpuStepienForSide({ leagueData, teamName, outgoingItems = [], incomingItems = [] } = {}) {
  const original = (Array.isArray(outgoingItems) ? outgoingItems : []).filter(Boolean);
  const originalFirsts = original.filter(isCpuFutureFirstItem);
  const originalFirstKeys = new Set(originalFirsts.map(cpuPickKey));
  const initialCapped = capCpuPackageToMax(original, originalFirstKeys, MAX_SIDE_ITEMS);
  const initial = cpuStepienPackageValidation(leagueData, teamName, initialCapped, incomingItems);

  if (initial.ok && cpuPackageAssetCount(initialCapped) <= MAX_SIDE_ITEMS) {
    return { ok: true, items: initialCapped, changed: cpuPackageAssetCount(original) !== cpuPackageAssetCount(initialCapped) };
  }

  // Keep CPU trades cheap: this repair layer is only here to sanitize Stepien.
  // If another rule blocks the package, do not run a picker-combination search.
  if (initial.code && initial.code !== "stepien_rule" && initial.code !== "too_many_assets") {
    return {
      ok: false,
      reason: initial.reason || "CPU trade package failed the active trade rules.",
      staleCode: initial.code || "cpu_trade_rule_block",
    };
  }

  if (!originalFirsts.length) {
    return {
      ok: false,
      reason: initial.reason || `${teamName} cannot satisfy Stepien with this CPU package.`,
      staleCode: initial.code || "cpu_stepien_repair_failed",
    };
  }

  const baseNonFirstItems = original
    .filter((item) => !isCpuFutureFirstItem(item))
    .sort((a, b) => cpuRepairedItemSortScore(b, originalFirstKeys) - cpuRepairedItemSortScore(a, originalFirstKeys))
    .slice(0, MAX_SIDE_ITEMS);
  const originalNonFirstPicks = original.filter((item) => item?.type === "pick" && !isCpuFutureFirstItem(item));
  const maxFirstSlots = Math.max(0, MAX_SIDE_ITEMS - cpuPackageAssetCount(baseNonFirstItems));
  const desiredFirstCount = Math.min(originalFirsts.length, maxFirstSlots);
  const usedPickKeys = new Set(baseNonFirstItems.filter((item) => item?.type === "pick").map(cpuPickKey));
  const firstPool = getCpuOwnedFirstRoundPickItems(leagueData, teamName, usedPickKeys);
  const attempts = [];
  const addAttempt = (combo, label) => {
    if (!Array.isArray(combo) || combo.length !== desiredFirstCount) return;
    const key = combo.map(cpuPickKey).join(";");
    if (!key || attempts.some((row) => row.key === key)) return;
    attempts.push({ key, combo, label });
  };

  if (desiredFirstCount > 0) {
    addAttempt(buildCpuGreedyFirstCombo(firstPool, desiredFirstCount, "preserve_original", originalFirstKeys), "preserve_original_firsts");
    addAttempt(buildCpuGreedyFirstCombo(firstPool, desiredFirstCount, "balanced", originalFirstKeys), "balanced_firsts");
    addAttempt(buildCpuGreedyFirstCombo(firstPool, desiredFirstCount, "later_years", originalFirstKeys), "later_firsts");
  }

  // Try only a few direct, deterministic repairs. No 1000+ combination search.
  for (const attempt of attempts.slice(0, 4)) {
    const trial = buildCpuTrialPackage({
      leagueData,
      teamName,
      baseItems: baseNonFirstItems,
      firstCombo: attempt.combo,
      originalNonFirstPicks,
      originalFirstKeys,
    });
    if (!cpuPackageAssetCount(trial)) continue;
    const validation = cpuStepienPackageValidation(leagueData, teamName, trial, incomingItems);
    if (validation.ok && cpuPackageAssetCount(trial) <= MAX_SIDE_ITEMS) {
      return { ok: true, items: trial, changed: true, replacementType: attempt.label };
    }
  }

  // Final cheap fallback: replace unsafe 1sts with available 2nds/filler. This
  // preserves CPU trade volume without letting Stepien turn one trade into a
  // deep combinatorial search.
  const secondsOnly = buildCpuTrialPackage({
    leagueData,
    teamName,
    baseItems: baseNonFirstItems,
    firstCombo: [],
    originalNonFirstPicks,
    originalFirstKeys,
  });
  const secondsValidation = cpuStepienPackageValidation(leagueData, teamName, secondsOnly, incomingItems);
  if (secondsValidation.ok && cpuPackageAssetCount(secondsOnly) > 0 && cpuPackageAssetCount(secondsOnly) <= MAX_SIDE_ITEMS) {
    return { ok: true, items: secondsOnly, changed: true, replacementType: "seconds" };
  }

  return {
    ok: false,
    reason: secondsValidation.reason || initial.reason || `${teamName} cannot satisfy Stepien after a cheap CPU pick repair.`,
    staleCode: secondsValidation.code || initial.code || "cpu_stepien_repair_failed",
  };
}

function repairCpuTradeStepienPackages({ leagueData, fromTeamName, toTeamName, fromItems = [], toItems = [] } = {}) {
  const settings = getUserTradeRuleSettings(leagueData);
  if (!settings.stepienRule) return { ok: true, fromItems, toItems, changed: false };

  const fromRepair = repairCpuStepienForSide({ leagueData, teamName: fromTeamName, outgoingItems: fromItems, incomingItems: toItems });
  if (!fromRepair.ok) return fromRepair;
  const toRepair = repairCpuStepienForSide({ leagueData, teamName: toTeamName, outgoingItems: toItems, incomingItems: fromRepair.items });
  if (!toRepair.ok) return toRepair;

  // One final validation pass only. Do not re-run the repair recursively for both
  // sides; that was the expensive Jan/deadline behavior regression.
  const finalFromValidation = cpuStepienPackageValidation(leagueData, fromTeamName, fromRepair.items, toRepair.items);
  if (!finalFromValidation.ok) {
    return {
      ok: false,
      reason: finalFromValidation.reason || "CPU trade candidate would violate Stepien after cheap package repair.",
      staleCode: finalFromValidation.code || "cpu_stepien_repair_failed",
    };
  }
  const finalToValidation = cpuStepienPackageValidation(leagueData, toTeamName, toRepair.items, fromRepair.items);
  if (!finalToValidation.ok) {
    return {
      ok: false,
      reason: finalToValidation.reason || "CPU trade candidate would violate Stepien after cheap package repair.",
      staleCode: finalToValidation.code || "cpu_stepien_repair_failed",
    };
  }

  return {
    ok: true,
    fromItems: fromRepair.items,
    toItems: toRepair.items,
    changed: Boolean(fromRepair.changed || toRepair.changed),
  };
}

function parseTradeDateMs(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function daysSinceTradeDate(currentDate = "", previousDate = "") {
  const current = parseTradeDateMs(currentDate);
  const previous = parseTradeDateMs(previousDate);
  if (current === null || previous === null) return null;
  return Math.floor((current - previous) / 86_400_000);
}

function isCpuCpuTradeRecord(row = {}) {
  return Boolean(row?.cpuCpuTrade || row?.source === "cpu_cpu_trade");
}

function findRecentCpuAcquisitionBlock({ leagueData, teamName = "", outgoingItems = [], currentDate = "" } = {}) {
  if (!teamName || !currentDate || !Array.isArray(outgoingItems) || !outgoingItems.length) return null;

  const outgoingNames = new Set(
    outgoingItems
      .filter((item) => item?.type === "player")
      .map((item) => normalizeTeamName(playerNameOf(item.player)))
      .filter(Boolean)
  );
  if (!outgoingNames.size) return null;

  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index];
    if (!isCpuCpuTradeRecord(row)) continue;

    const elapsedDays = daysSinceTradeDate(currentDate, row?.date || row?.currentDate);
    if (elapsedDays === null || elapsedDays < 0 || elapsedDays > CPU_CPU_RECENT_ACQUISITION_COOLDOWN_DAYS) continue;

    const movedPlayers = Array.isArray(row?.movedPlayers) ? row.movedPlayers : [];
    const blockedMove = movedPlayers.find((move) =>
      sameTeamName(move?.toTeam, teamName) && outgoingNames.has(normalizeTeamName(move?.name))
    );

    if (blockedMove) {
      return {
        playerName: blockedMove.name || "recently acquired player",
        acquiredDate: row?.date || row?.currentDate || "recently",
        elapsedDays,
      };
    }
  }

  return null;
}

const cpuTradeEvaluationRecordWrappers = new WeakMap();

function attachCpuTradeRecordsForEvaluation(leagueData = {}, recordsByTeam = null) {
  if (!recordsByTeam || typeof recordsByTeam !== "object") {
    return leagueData;
  }

  if (leagueData?.__cpuTradeRecords === recordsByTeam) return leagueData;

  if (leagueData && typeof leagueData === "object") {
    let byRecords = cpuTradeEvaluationRecordWrappers.get(leagueData);
    if (!byRecords) {
      byRecords = new WeakMap();
      cpuTradeEvaluationRecordWrappers.set(leagueData, byRecords);
    }
    if (byRecords.has(recordsByTeam)) return byRecords.get(recordsByTeam);

    const wrapped = { ...leagueData };
    Object.defineProperty(wrapped, "__cpuTradeRecords", {
      value: recordsByTeam,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    byRecords.set(recordsByTeam, wrapped);
    return wrapped;
  }

  return leagueData;
}

function cpuTradeTimingValidation({ currentDate = "", tradeDeadlineDate = "", inOffseason = false } = {}) {
  if (inOffseason) {
    return {
      ok: false,
      reason: "CPU-to-CPU trades are disabled during the offseason.",
      staleCode: "offseason_locked",
    };
  }

  if (currentDate && tradeDeadlineDate && String(currentDate) >= String(tradeDeadlineDate)) {
    return {
      ok: false,
      reason: "CPU-to-CPU trades are disabled at and after the trade deadline.",
      staleCode: "trade_deadline_locked",
    };
  }

  return { ok: true };
}

export function validateCpuTradeCandidateOnLeague({
  leagueData,
  candidate,
  currentDate = "",
  tradeDeadlineDate = "",
  inOffseason = false,
  recordsByTeam = null,
} = {}) {
  const timingValidation = cpuTradeTimingValidation({ currentDate, tradeDeadlineDate, inOffseason });
  if (!timingValidation.ok) return timingValidation;

  const evaluationLeagueData = attachCpuTradeRecordsForEvaluation(leagueData, recordsByTeam);

  const fromTeamName = candidate?.fromTeamName || candidate?.sellerTeamName || candidate?.teamA || "";
  const toTeamName = candidate?.toTeamName || candidate?.buyerTeamName || candidate?.teamB || "";
  const rawFromItems = Array.isArray(candidate?.fromItems) ? candidate.fromItems : [];
  const rawToItems = Array.isArray(candidate?.toItems) ? candidate.toItems : [];

  if (!evaluationLeagueData || !fromTeamName || !toTeamName) {
    return { ok: false, reason: "CPU trade candidate is missing one or both teams.", staleCode: "missing_team" };
  }

  if (sameTeamName(fromTeamName, toTeamName)) {
    return { ok: false, reason: "CPU trade candidate cannot trade a team with itself.", staleCode: "same_team" };
  }

  const fromTeam = findTeamInLeague(evaluationLeagueData, fromTeamName);
  const toTeam = findTeamInLeague(evaluationLeagueData, toTeamName);
  if (!fromTeam || !toTeam) {
    return {
      ok: false,
      reason: "CPU trade candidate referenced a team that no longer exists.",
      staleCode: "missing_team",
    };
  }

  if (!rawFromItems.length || !rawToItems.length) {
    return { ok: false, reason: "CPU trade candidate needs assets from both teams.", staleCode: "empty_package" };
  }

  const resolvedFrom = resolveCurrentCpuTradeItems(evaluationLeagueData, fromTeamName, rawFromItems);
  if (!resolvedFrom.ok) return resolvedFrom;

  const resolvedTo = resolveCurrentCpuTradeItems(evaluationLeagueData, toTeamName, rawToItems);
  if (!resolvedTo.ok) return resolvedTo;

  // Performance critical: normal CPU-bank candidate validation should mirror the
  // old fast engine. Stepien is sanitized only at the final execution gate below;
  // running the pick-repair layer for every generated candidate made midseason
  // sim crawl as soon as the CPU trade market opened.
  const fromItems = resolvedFrom.items;
  const toItems = resolvedTo.items;
  const fromCooldownBlock = findRecentCpuAcquisitionBlock({
    leagueData: evaluationLeagueData,
    teamName: fromTeamName,
    outgoingItems: fromItems,
    currentDate,
  });
  if (fromCooldownBlock) {
    return {
      ok: false,
      reason: `${fromTeamName} will not immediately re-trade ${fromCooldownBlock.playerName}; acquired ${fromCooldownBlock.elapsedDays} days ago.`,
      staleCode: "recent_cpu_trade_player_cooldown",
      cooldown: fromCooldownBlock,
    };
  }

  const toCooldownBlock = findRecentCpuAcquisitionBlock({
    leagueData: evaluationLeagueData,
    teamName: toTeamName,
    outgoingItems: toItems,
    currentDate,
  });
  if (toCooldownBlock) {
    return {
      ok: false,
      reason: `${toTeamName} will not immediately re-trade ${toCooldownBlock.playerName}; acquired ${toCooldownBlock.elapsedDays} days ago.`,
      staleCode: "recent_cpu_trade_player_cooldown",
      cooldown: toCooldownBlock,
    };
  }
  const fromRosterProjection = evaluateTradeRosterProjection({
    team: fromTeam,
    outgoingItems: fromItems,
    incomingItems: toItems,
    inOffseason: false,
  });
  const toRosterProjection = evaluateTradeRosterProjection({
    team: toTeam,
    outgoingItems: toItems,
    incomingItems: fromItems,
    inOffseason: false,
  });

  // CPU teams may complete unequal-player trades that temporarily leave one side
  // below the game-ready minimum. Calendar repairs CPU rosters immediately after
  // execution and before the next game. The hard trade blocker is only the
  // temporary transaction ceiling: 16, or one more than the team already has.
  if (!fromRosterProjection.ok || !toRosterProjection.ok) {
    const blocked = !fromRosterProjection.ok ? fromRosterProjection : toRosterProjection;
    return {
      ok: false,
      reason: blocked.reason,
      staleCode: "roster_maximum",
      fromRosterProjection,
      toRosterProjection,
    };
  }

  const cpuTradeContext = {
    ...(candidate?.debug || {}),
    bankId: candidate?.bankId || candidate?.id || "",
    generatedDate: candidate?.bankMeta?.generatedDate || candidate?.generatedDate || "",
  };

  const toTeamView = evaluateTradeTeamImpact({
    leagueData: evaluationLeagueData,
    userTeam: fromTeam,
    cpuTeam: toTeam,
    userTeamName: fromTeamName,
    cpuTeamName: toTeamName,
    userItems: fromItems,
    cpuItems: toItems,
    evaluationMode: "cpu_cpu_trade",
    cpuTradeRole: "buyer",
    cpuTradeContext,
  });

  if (!hasAcceptedEvaluation(toTeamView)) {
    return {
      ok: false,
      reason: toTeamView?.message || `${toTeamName} rejected the CPU trade candidate.`,
      staleCode: "buyer_rejected",
      toTeamView,
    };
  }

  const fromTeamView = evaluateTradeTeamImpact({
    leagueData: evaluationLeagueData,
    userTeam: toTeam,
    cpuTeam: fromTeam,
    userTeamName: toTeamName,
    cpuTeamName: fromTeamName,
    userItems: toItems,
    cpuItems: fromItems,
    evaluationMode: "cpu_cpu_trade",
    cpuTradeRole: "seller",
    cpuTradeContext,
  });

  if (!hasAcceptedEvaluation(fromTeamView)) {
    return {
      ok: false,
      reason: fromTeamView?.message || `${fromTeamName} rejected the CPU trade candidate.`,
      staleCode: "seller_rejected",
      fromTeamView,
      toTeamView,
    };
  }

  const combinedEvaluation = {
    accepted: true,
    decision: "accept",
    score: Number(toTeamView?.score || 0) + Number(fromTeamView?.score || 0),
    reasons: [
      candidate?.motive || "CPU-to-CPU trade matched both teams' direction.",
      ...(Array.isArray(toTeamView?.reasons) ? toTeamView.reasons.slice(0, 2) : []),
      ...(Array.isArray(fromTeamView?.reasons) ? fromTeamView.reasons.slice(0, 2) : []),
    ],
  };

  const executionValidation = validateTradeForExecution({
    leagueData: evaluationLeagueData,
    userTeam: fromTeam,
    cpuTeam: toTeam,
    userItems: fromItems,
    cpuItems: toItems,
    evaluation: combinedEvaluation,
    inOffseason,
  });

  if (!executionValidation.ok) {
    return {
      ...executionValidation,
      staleCode: executionValidation.staleCode || "execution_legality_changed",
      fromTeamView,
      toTeamView,
    };
  }

  return {
    ok: true,
    candidate: {
      ...candidate,
      fromTeamName,
      toTeamName,
      fromItems,
      toItems,
    },
    fromTeam,
    toTeam,
    fromItems,
    toItems,
    fromTeamView,
    toTeamView,
    evaluation: combinedEvaluation,
    executionValidation,
    fromRosterProjection,
    toRosterProjection,
    requiresRosterRepairBeforeSimulation: Boolean(
      fromRosterProjection.requiresRepairBeforeSimulation ||
        toRosterProjection.requiresRepairBeforeSimulation
    ),
  };
}


export function executeCpuMegaTradeCandidateOnLeagueLoose({
  leagueData,
  candidate,
  currentDate = "",
  tradeDeadlineDate = "",
  inOffseason = false,
  recordsByTeam = null,
} = {}) {
  const timingValidation = cpuTradeTimingValidation({ currentDate, tradeDeadlineDate, inOffseason });
  if (!timingValidation.ok) return timingValidation;

  const evaluationLeagueData = attachCpuTradeRecordsForEvaluation(leagueData, recordsByTeam);
  const fromTeamName = candidate?.fromTeamName || candidate?.sellerTeamName || candidate?.teamA || "";
  const toTeamName = candidate?.toTeamName || candidate?.buyerTeamName || candidate?.teamB || "";
  const rawFromItems = Array.isArray(candidate?.fromItems) ? candidate.fromItems : [];
  const rawToItems = Array.isArray(candidate?.toItems) ? candidate.toItems : [];

  if (!evaluationLeagueData || !fromTeamName || !toTeamName) {
    return { ok: false, reason: "Mega trade candidate is missing one or both teams.", staleCode: "missing_team" };
  }
  if (sameTeamName(fromTeamName, toTeamName)) {
    return { ok: false, reason: "Mega trade candidate cannot trade a team with itself.", staleCode: "same_team" };
  }

  const fromTeam = findTeamInLeague(evaluationLeagueData, fromTeamName);
  const toTeam = findTeamInLeague(evaluationLeagueData, toTeamName);
  if (!fromTeam || !toTeam) {
    return { ok: false, reason: "Mega trade candidate referenced a missing team.", staleCode: "missing_team" };
  }
  if (!rawFromItems.length || !rawToItems.length) {
    return { ok: false, reason: "Mega trade candidate needs assets from both teams.", staleCode: "empty_package" };
  }

  const resolvedFrom = resolveCurrentCpuTradeItems(evaluationLeagueData, fromTeamName, rawFromItems);
  if (!resolvedFrom.ok) return resolvedFrom;
  const resolvedTo = resolveCurrentCpuTradeItems(evaluationLeagueData, toTeamName, rawToItems);
  if (!resolvedTo.ok) return resolvedTo;

  let fromItems = resolvedFrom.items;
  let toItems = resolvedTo.items;
  const stepienRepair = repairCpuTradeStepienPackages({ leagueData: evaluationLeagueData, fromTeamName, toTeamName, fromItems, toItems });
  if (!stepienRepair.ok) {
    return {
      ok: false,
      reason: stepienRepair.reason || "Mega trade candidate would violate the active Stepien rule.",
      staleCode: stepienRepair.staleCode || "cpu_mega_stepien_rule",
    };
  }
  fromItems = stepienRepair.fromItems;
  toItems = stepienRepair.toItems;
  const outgoingStar = fromItems.find((item) => item?.type === "player")?.player || null;
  const guaranteedMegaFallback = Boolean(candidate?.debug?.guaranteedMegaFallback || candidate?.guaranteedMegaFallback);
  const sellerBlockReason = guaranteedMegaFallback
    ? ""
    : strictMegaSellerExecutionBlockReason(evaluationLeagueData, recordsByTeam || {}, fromTeam, outgoingStar);
  if (sellerBlockReason) {
    return {
      ok: false,
      reason: `Mega trade seller blocked: ${fromTeamName} is not a valid star seller (${sellerBlockReason}).`,
      staleCode: sellerBlockReason,
    };
  }
  const fromRosterProjection = evaluateTradeRosterProjection({
    team: fromTeam,
    outgoingItems: fromItems,
    incomingItems: toItems,
    inOffseason: false,
  });
  const toRosterProjection = evaluateTradeRosterProjection({
    team: toTeam,
    outgoingItems: toItems,
    incomingItems: fromItems,
    inOffseason: false,
  });
  if (!fromRosterProjection.ok || !toRosterProjection.ok) {
    const blocked = !fromRosterProjection.ok ? fromRosterProjection : toRosterProjection;
    return {
      ok: false,
      reason: blocked.reason,
      staleCode: "roster_maximum",
      fromRosterProjection,
      toRosterProjection,
    };
  }

  const targetName = fromItems.find((item) => item?.type === "player")?.player?.name || "a 90+ star";
  const evaluation = {
    accepted: true,
    decision: "accept",
    score: 999,
    message: "Mega deadline deal legal check passed.",
    reasons: [
      candidate?.motive || `${toTeamName} makes a bonus deadline swing for ${targetName}.`,
      `${fromTeamName} gets a legal mega package of players and/or draft picks.`,
      `${toTeamName} gets the best player in a title-window move.`,
    ],
  };

  const executionValidation = validateTradeForExecution({
    leagueData: evaluationLeagueData,
    userTeam: fromTeam,
    cpuTeam: toTeam,
    userItems: fromItems,
    cpuItems: toItems,
    evaluation,
    inOffseason,
  });
  if (!executionValidation.ok) {
    return {
      ...executionValidation,
      staleCode: executionValidation.staleCode || "mega_execution_legality_changed",
      fromRosterProjection,
      toRosterProjection,
    };
  }

  const execution = executeAcceptedTradeOnLeague({
    leagueData,
    userTeamName: fromTeamName,
    cpuTeamName: toTeamName,
    userItems: fromItems,
    cpuItems: toItems,
    evaluation,
    inOffseason,
  });
  if (!execution.ok) {
    return { ...execution, staleCode: execution.staleCode || "mega_execution_failed" };
  }

  const cpuTiming = getTradeTimingSnapshot(leagueData);
  const buyerReason = `${toTeamName} accepted because a contender is making a legal bonus mega-deadline swing for ${targetName}.`;
  const sellerReason = `${fromTeamName} accepted because the team is converting a prime/older 90+ star into a legal package of salary, young value, and draft assets.`;
  const patchedTradeRecord = {
    ...(execution.tradeRecord || {}),
    source: "cpu_cpu_trade",
    cpuCpuTrade: true,
    cpuMegaTrade: true,
    megaTrade: true,
    megaDeadlineDeal: true,
    tradeType: "cpu_mega_trade",
    tradeLabel: "Mega Deadline Deal",
    fromTeamName,
    toTeamName,
    date: candidate?.currentDate || candidate?.date || currentDate || (execution.tradeRecord || {}).date || cpuTiming.date,
    currentDate: candidate?.currentDate || candidate?.date || currentDate || (execution.tradeRecord || {}).currentDate || cpuTiming.currentDate,
    day: candidate?.day ?? candidate?.currentDay ?? candidate?.dayIndex ?? (execution.tradeRecord || {}).day ?? cpuTiming.day,
    dayIndex: candidate?.dayIndex ?? candidate?.day ?? candidate?.currentDay ?? (execution.tradeRecord || {}).dayIndex ?? cpuTiming.dayIndex,
    motive: candidate?.motive || `Mega Deadline Deal: ${toTeamName} makes a title-window swing for ${targetName}.`,
    bankId: candidate?.bankId || candidate?.id || null,
    reasoning: {
      ...((execution.tradeRecord || {}).reasoning || {}),
      [fromTeamName]: sellerReason,
      [toTeamName]: buyerReason,
    },
    teamPackages: Array.isArray((execution.tradeRecord || {}).teamPackages)
      ? (execution.tradeRecord || {}).teamPackages.map((side) => ({
          ...side,
          reason: side.teamName === fromTeamName ? sellerReason : side.teamName === toTeamName ? buyerReason : side.reason,
        }))
      : (execution.tradeRecord || {}).teamPackages,
    fromTeamView: { accepted: true, decision: "accept", score: 500, reasons: [sellerReason] },
    toTeamView: { accepted: true, decision: "accept", score: 500, reasons: [buyerReason] },
  };

  return {
    ...execution,
    leagueData: {
      ...execution.leagueData,
      tradeHistory: [
        ...(Array.isArray(execution.leagueData?.tradeHistory) ? execution.leagueData.tradeHistory.slice(0, -1) : []),
        patchedTradeRecord,
      ],
      lastTrade: patchedTradeRecord,
    },
    tradeRecord: patchedTradeRecord,
    fromRosterProjection,
    toRosterProjection,
    requiresRosterRepairBeforeSimulation: Boolean(
      fromRosterProjection.requiresRepairBeforeSimulation || toRosterProjection.requiresRepairBeforeSimulation
    ),
  };
}

export function executeCpuTradeCandidateOnLeague({
  leagueData,
  candidate,
  currentDate = "",
  tradeDeadlineDate = "",
  inOffseason = false,
  recordsByTeam = null,
} = {}) {
  const validation = validateCpuTradeCandidateOnLeague({
    leagueData,
    candidate,
    currentDate,
    tradeDeadlineDate,
    inOffseason,
    recordsByTeam,
  });

  if (!validation.ok) return validation;

  const hydratedCandidate = validation.candidate;
  const fromTeamName = hydratedCandidate.fromTeamName;
  const toTeamName = hydratedCandidate.toTeamName;
  const fromItems = hydratedCandidate.fromItems;
  const toItems = hydratedCandidate.toItems;
  const fromTeamView = validation.fromTeamView;
  const toTeamView = validation.toTeamView;

  const execution = executeAcceptedTradeOnLeague({
    leagueData,
    userTeamName: fromTeamName,
    cpuTeamName: toTeamName,
    userItems: fromItems,
    cpuItems: toItems,
    evaluation: validation.evaluation,
    inOffseason,
  });

  if (!execution.ok) {
    return {
      ...execution,
      staleCode: execution.staleCode || "execution_failed",
      fromTeamView,
      toTeamView,
    };
  }

  const cpuTiming = getTradeTimingSnapshot(leagueData);
  const candidateMegaTrade = Boolean(
    hydratedCandidate?.megaTrade ||
      hydratedCandidate?.cpuMegaTrade ||
      hydratedCandidate?.tradeType === "cpu_mega_trade" ||
      hydratedCandidate?.debug?.megaTrade ||
      hydratedCandidate?.bankMeta?.megaTrade
  );
  const buyerReason = reasonFromTeamView(
    toTeamName,
    toTeamView,
    hydratedCandidate?.motive || `${toTeamName} wanted to add ${summarizeAssetsForReason(fromItems)}.`
  );
  const sellerReason = reasonFromTeamView(
    fromTeamName,
    fromTeamView,
    hydratedCandidate?.motive || `${fromTeamName} wanted to add ${summarizeAssetsForReason(toItems)}.`
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
    cpuMegaTrade: candidateMegaTrade,
    megaTrade: candidateMegaTrade,
    tradeType: candidateMegaTrade ? "cpu_mega_trade" : "cpu_cpu_trade",
    fromTeamName,
    toTeamName,
    date: hydratedCandidate?.currentDate || hydratedCandidate?.date || currentDate || (execution.tradeRecord || {}).date || cpuTiming.date,
    currentDate: hydratedCandidate?.currentDate || hydratedCandidate?.date || currentDate || (execution.tradeRecord || {}).currentDate || cpuTiming.currentDate,
    day: hydratedCandidate?.day ?? hydratedCandidate?.currentDay ?? hydratedCandidate?.dayIndex ?? (execution.tradeRecord || {}).day ?? cpuTiming.day,
    dayIndex: hydratedCandidate?.dayIndex ?? hydratedCandidate?.day ?? hydratedCandidate?.currentDay ?? (execution.tradeRecord || {}).dayIndex ?? cpuTiming.dayIndex,
    motive: hydratedCandidate?.motive || "",
    bankId: hydratedCandidate?.bankId || hydratedCandidate?.id || null,
    bankGeneratedDate: hydratedCandidate?.bankMeta?.generatedDate || hydratedCandidate?.generatedDate || null,
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

  const leagueWithCpuRecord = {
    ...execution.leagueData,
    tradeHistory: [
      ...(Array.isArray(execution.leagueData?.tradeHistory)
        ? execution.leagueData.tradeHistory.slice(0, -1)
        : []),
      tradeRecord,
    ],
    lastTrade: tradeRecord,
  };

  // Do not change CPU trade generation/evaluation. After a CPU deal has already
  // completed, only stamp user-facing eligibility locks so the user cannot
  // immediately flip or target the newly acquired players.
  const leagueWithUserLocks = stampUserTradeAcquisitionRestrictions({
    leagueData: leagueWithCpuRecord,
    movedPlayers: tradeRecord.movedPlayers,
    currentDate: tradeRecord.currentDate || tradeRecord.date,
    source: candidateMegaTrade ? "cpu_mega_trade" : "cpu_cpu_trade",
    sourceTransactionId: tradeRecord.id,
  });

  return {
    ...execution,
    leagueData: leagueWithUserLocks,
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
